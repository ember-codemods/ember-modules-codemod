const fs       = require("fs");
const RESERVED = require("ember-rfc176-data/reserved");
const MAPPINGS = require("ember-rfc176-data");

const LOG_FILE = "ember-modules-codemod.tmp." + process.pid;
const ERROR_WARNING = 1;
const MISSING_GLOBAL_WARNING = 2;

const OPTS = {
  quote: 'single',
};

module.exports = transform;

/**
 * This is the entry point for this jscodeshift transform.
 * It scans JavaScript files that use the Ember global and updates
 * them to use the module syntax from the proposed new RFC.
 */
function transform(file, api, options) {
  let source = file.source;
  let j = api.jscodeshift;

  let root = j(source);

  // Track any use of `Ember.*` that isn't accounted for in the mapping. We'll
  // use this at the end to generate a report.
  let warnings = [];

  try {
    // Discover existing module imports, if any, in the file. If the user has
    // already imported one or more exports that we rewrite a global with, we
    // won't import them again. We also try to be smart about not adding multiple
    // import statements to import from the same module, condensing default
    // exports and named exports into one line if necessary.
    let modules = findExistingModules(root);

    // Build a data structure that tells us how to map properties on the Ember
    // global into the module syntax.
    let mappings = buildMappings(modules);

    let globalEmber = getGlobalEmberName(root);

    // Discover global aliases for Ember keys that are introduced via destructuring,
    // e.g. `const { String: { underscore } } = Ember;`.
    let globalAliases = findGlobalEmberAliases(root, globalEmber, mappings);

    // Resolve the discovered aliases agains the module registry. We intentionally do
    // this ahead of finding replacements for e.g. `Ember.String.underscore` usage in
    // order to reuse custom names for any fields referenced both ways.
    resolveAliasImports(globalAliases, mappings, modules);

    // Scan the source code, looking for any instances of the `Ember` identifier
    // used as the root of a property lookup. If they match one of the provided
    // mappings, save it off for replacement later.
    let replacements = findUsageOfEmberGlobal(root, globalEmber)
      .map(findReplacement(mappings));

    // Now that we've identified all of the replacements that we need to do, we'll
    // make sure to either add new `import` declarations, or update existing ones
    // to add new named exports or the default export.
    updateOrCreateImportDeclarations(root, modules);

    // Actually go through and replace each usage of `Ember.whatever` with the
    // imported binding (`whatever`).
    applyReplacements(replacements);

    // Finally remove global Ember import if no globals left
    removeGlobalEmber(root, globalEmber);

    // jscodeshift is not so great about giving us control over the resulting whitespace.
    // We'll use a regular expression to try to improve the situation (courtesy of @rwjblue).
    source = beautifyImports(root.toSource(OPTS));
  } catch (e) {
    if (process.env.EMBER_MODULES_CODEMOD) {
      warnings.push([ERROR_WARNING, file.path, source, e.stack]);
    }

    throw e;
  } finally {
    // If there were modules that we didn't know about, write them to a log file.
    // We only do this if invoked via the CLI tool, not jscodeshift directly,
    // because jscodeshift doesn't give us a cleanup hook when everything is done
    // to parse these files. (This is what the environment variable is checking.)
    if (warnings.length && process.env.EMBER_MODULES_CODEMOD) {
      warnings.forEach(warning => {
        fs.appendFileSync(LOG_FILE, JSON.stringify(warning) + "\n");
      });
    }
  }

  return source;

  /**
   * Loops through the raw JSON data in `mapping.json` and converts each entry
   * into a Mapping instance. The Mapping class lazily reifies its associated
   * module as they it is consumed.
   */
  function buildMappings(registry) {
    let mappings = {};

    for (let mapping of Object.keys(MAPPINGS)) {
      mappings[mapping] = new Mapping(MAPPINGS[mapping], registry);
    }

    return mappings;
  }

  function getGlobalEmberImport(root) {
    return root.find(j.ImportDeclaration, {
      specifiers: [{
        type: "ImportDefaultSpecifier",
      }],
      source: {
        value: "ember"
      }
    });
  }

  function getGlobalEmberName(root) {
    const globalEmber = getGlobalEmberImport(root);

    let defaultImport = globalEmber.find(j.Identifier);
    let defaultMemberName = defaultImport.size() && defaultImport.get(0).node.name;

    return defaultMemberName || "Ember";
  }

  /*
  * Finds all uses of a property looked up on the Ember global (i.e.,
  * `Ember.something`). Makes sure that it is actually the Ember global
  * and not another variable that happens to be called `Ember`.
  */
  function findUsageOfEmberGlobal(root, globalEmber) {
    let emberUsages = root.find(j.MemberExpression, {
      object: {
        name: globalEmber,
      },
    });

    return emberUsages.filter(isEmberGlobal(globalEmber)).paths();
  }

  // Find destructured global aliases for fields on the Ember global
  function findGlobalEmberAliases(root, globalEmber, mappings) {
    let aliases = {};
    let assignments = findUsageOfDestructuredEmber(root, globalEmber);
    for (let assignment of assignments) {
      let emberPath = joinEmberPath(assignment.get('init'), globalEmber);
      for (let alias of extractAliases(mappings, assignment.get('id'), emberPath)) {
        aliases[alias.identifier.node.name] = alias;
      }
    }
    return aliases;
  }

  function findUsageOfDestructuredEmber(root, globalEmber) {
    let uses = root.find(j.VariableDeclarator, (node) => {
      if (j.Identifier.check(node.init)) {
        return node.init.name === globalEmber;
      } else if (j.MemberExpression.check(node.init)) {
        return node.init.object.name === globalEmber;
      }
    });

    return uses.paths();
  }

  function joinEmberPath(nodePath, globalEmber) {
    if (j.Identifier.check(nodePath.node)) {
      if (nodePath.node.name !== globalEmber) {
        return nodePath.node.name;
      }
    } else if (j.MemberExpression.check(nodePath.node)) {
      let lhs = nodePath.node.object.name;
      let rhs = joinEmberPath(nodePath.get('property'));
      if (lhs === globalEmber) {
        return rhs;
      } else {
        return `${lhs}.${rhs}`;
      }
    }
  }

  // Determine aliases introduced by the given destructuring pattern, removing
  // items from the pattern when they're available via a module import instead.
  function extractAliases(mappings, pattern, emberPath) {
    if (j.Identifier.check(pattern.node)) {
      if (emberPath in mappings) {
        pattern.parentPath.prune();
        return [new GlobalAlias(pattern, emberPath)];
      } else {
        warnMissingGlobal(pattern.parentPath, emberPath);
      }
    } else if (j.ObjectPattern.check(pattern.node)) {
      let aliases = findObjectPatternAliases(mappings, pattern, emberPath);
      if (!pattern.node.properties.length) {
        pattern.parentPath.prune();
      }
      return aliases;
    }

    return [];
  }

  function findObjectPatternAliases(mappings, objectPattern, basePath) {
    let aliases = [];
    for (let i = objectPattern.node.properties.length - 1; i >= 0; i--) {
      let property = objectPattern.get('properties', i);
      let propertyName = property.node.key.name;
      let fullPath = basePath ? `${basePath}.${propertyName}` : propertyName;
      aliases = aliases.concat(extractAliases(mappings, property.get('value'), fullPath));
    }
    return aliases;
  }

  function resolveAliasImports(aliases, mappings, registry) {
    for (let globalName of Object.keys(aliases)) {
      let alias = aliases[globalName];
      let mapping = mappings[alias.emberPath];
      registry.get(mapping.source, mapping.imported, alias.identifier.node.name);
    }
  }

  /**
   * Returns a function that can be used to map an array of MemberExpression
   * nodes into Replacement instances. Does the actual work of verifying if the
   * `Ember` identifier used in the MemberExpression is actually replaceable.
  */
  function findReplacement(mappings) {
    return function(path) {
      // Expand the full set of property lookups. For example, we don't want
      // just "Ember.computed"—we want "Ember.computed.or" as well.
      let candidates = expandMemberExpressions(path);

      // This will give us an array of tuples ([pathString, node]) that represent
      // the possible replacements, from most-specific to least-specific. For example:
      //
      //   [Ember.computed.reads, Ember.computed], or
      //   [Ember.Object.extend, Ember.Object]
      //
      // We'll go through these to find the most specific candidate that matches
      // our global->ES6 map.
      let found = candidates.find(([_, propertyPath]) => {
        return propertyPath in mappings;
      });

      // If we got this far but didn't find a viable candidate, that means the user is
      // using something on the `Ember` global that we don't have a module equivalent for.
      if (!found) {
        warnMissingGlobal(path, candidates[candidates.length-1][1]);
        return null;
      }

      let [nodePath, propertyPath] = found;
      let mapping = mappings[propertyPath];

      let mod = mapping.getModule();
      if (!mod.local) {
        // Ember.computed.or => or
        let local = propertyPath.split(".").slice(-1)[0];
        if (includes(RESERVED, local)) {
          local = `Ember${local}`;
        }
        mod.local = local;
      }

      return new Replacement(nodePath, mod);
    };
  }

  function warnMissingGlobal(nodePath, emberPath) {
    let context = extractSourceContext(nodePath);
    let lineNumber = nodePath.value.loc.start.line;
    warnings.push([MISSING_GLOBAL_WARNING, emberPath, lineNumber, file.path, context]);
  }

  function extractSourceContext(path) {
    let start = path.node.loc.start.line;
    let end = path.node.loc.end.line;

    let lines = source.split("\n");

    start = Math.max(start-2, 1)-1;
    end = Math.min(end+2, lines.length);

    return lines.slice(start, end).join("\n");
  }

  function applyReplacements(replacements) {
    replacements
      .filter(r => !!r)
      .forEach(replacement => {
        let local = replacement.mod.local;
        let nodePath = replacement.nodePath;

        if (isAliasVariableDeclarator(nodePath, local)) {
          nodePath.parent.prune();
        } else {
          nodePath.replace(j.identifier(local));
        }
      });
  }

  function removeGlobalEmber(root, globalEmber) {
    let remainingGlobals = findUsageOfEmberGlobal(root, globalEmber);
    let remainingDestructuring = findUsageOfDestructuredEmber(root, globalEmber);

    if (!remainingGlobals.length && !remainingDestructuring.length) {
      getGlobalEmberImport(root).remove();
    }
  }

  function isAliasVariableDeclarator(nodePath, local) {
    let parent = nodePath.parent;

    if (!parent) { return false; }
    if (!j.VariableDeclarator.check(parent.node)) { return false; }

    if (parent.node.id.name === local) {
      return true;
    }

    return false;
  }

  function updateOrCreateImportDeclarations(root, registry) {
    let body = root.get().value.program.body;

    registry.modules.forEach(mod => {
      if (!mod.node) {
        let { source, imported, local } = mod;

        let declaration = root.find(j.ImportDeclaration, {
          source: { value: mod.source }
        });

        if (declaration.size() > 0) {
          let specifier;

          if (imported === 'default') {
            specifier = j.importDefaultSpecifier(j.identifier(local));
            declaration.get("specifiers").unshift(specifier);
          } else {
            specifier = j.importSpecifier(j.identifier(imported), j.identifier(local));
            declaration.get("specifiers").push(specifier);
          }

          mod.node = declaration.at(0);
        } else {
          let importStatement = createImportStatement(source, imported, local);
          body.unshift(importStatement);
          body[0].comments = body[1].comments;
          delete body[1].comments;
          mod.node = importStatement;
        }
      }
    });
  }

  function findUsedModules(replacements, existingModules) {
    let modules = [];
    let modulesBySource = {};

    replacements.forEach(r => {
      let replacementModule = r.mapping.mod;
      let byImported = modulesBySource[replacementModule.source];
      if (!byImported) {
        byImported = modulesBySource[replacementModule.source] = {};
      }

      let seenModule = byImported[replacementModule.imported];
      if (!seenModule) {
        byImported[replacementModule.imported] = true;
        modules.push(replacementModule);
      }
    });

    return modules;
  }

  function findExistingModules(root) {
    let registry = new ModuleRegistry();

    root
      .find(j.ImportDeclaration)
      .forEach(({ node }) => {
        let source = node.source.value;

        node.specifiers.forEach(spec => {
          let isDefault = j.ImportDefaultSpecifier.check(spec);

          // Some cases like `import * as bar from "foo"` have neither a
          // default nor a named export, which we don't currently handle.
          let imported = isDefault ? "default" :
            (spec.imported ? spec.imported.name : null);

          if (!imported) { return; }

          if (!registry.find(source, imported)) {
            let mod = registry.create(source, imported, spec.local.name);
            mod.node = node;
          }
        });
      });

    return registry;
  }


  function expandMemberExpressions(path) {
    let propName = path.node.property.name;
    let expressions = [[path, propName]];

    let currentPath = path;

    while (currentPath = currentPath.parent) {
      if (j.MemberExpression.check(currentPath.node)) {
        propName = propName + "." + currentPath.value.property.name;
        expressions.push([currentPath, propName]);
      } else {
        break;
      }
    }

    return expressions.reverse();
  }

  // Flagrantly stolen from https://github.com/5to6/5to6-codemod/blob/master/utils/main.js
  function createImportStatement(source, imported, local) {
    var declaration, variable, idIdentifier, nameIdentifier;
    // console.log('variableName', variableName);
    // console.log('moduleName', moduleName);

    // if no variable name, return `import 'jquery'`
    if (!local) {
      declaration = j.importDeclaration([], j.literal(source));
      return declaration;
    }

    // multiple variable names indicates a destructured import
    if (Array.isArray(local)) {
      var variableIds = local.map(function (v) {
        return j.importSpecifier(j.identifier(v), j.identifier(v));
      });

      declaration = j.importDeclaration(variableIds, j.literal(source));
    } else {
      // else returns `import $ from 'jquery'`
      nameIdentifier = j.identifier(local); //import var name
      variable = j.importDefaultSpecifier(nameIdentifier);

      // if propName, use destructuring `import {pluck} from 'underscore'`
      if (imported && imported !== "default") {
        idIdentifier = j.identifier(imported);
        variable = j.importSpecifier(idIdentifier, nameIdentifier); // if both are same, one is dropped...
      }

      declaration = j.importDeclaration([variable], j.literal(source));
    }

    return declaration;
  }

  function isEmberGlobal(name) {
    return function(path) {
      let localEmber = !path.scope.isGlobal && path.scope.declares(name);
      return !localEmber;
    };
  }

  function beautifyImports(source) {
    return source.replace(/\bimport.+from/g, (importStatement) => {
      let openCurly = importStatement.indexOf('{');
      let closeCurly = importStatement.indexOf('}');

      // leave default only imports alone
      if (openCurly === -1) { return importStatement; }

      if (importStatement.length > 50) {
        // if the segment is > 50 chars make it multi-line
        let result = importStatement.slice(0, openCurly + 1);
        let named = importStatement
              .slice(openCurly + 1, -6).split(',')
              .sort()
              .map(name => `\n  ${name.trim()}`);

        return result + named.join(',') + '\n} from';
      } else {

        let result = importStatement.slice(0, openCurly + 1);
        let named = importStatement
          .slice(openCurly + 1, -6).split(',').sort();

        const sorted = result + named.join(',') + '\n} from';
        // if the segment is < 50 chars sort and make sure it has proper spacing
        return sorted
          .replace(/,\s*/g, ', ') // ensure there is a space after commas
          .replace(/\{\s*/, '{ ')
          .replace(/\s*\}/, ' }');
      }
    });
  }
}

function includes(array, value) {
  return array.indexOf(value) > -1;
}

class ModuleRegistry {
  constructor() {
    this.bySource = {};
    this.modules = [];
  }

  findModule(mod) {
    return this.find(mod.source, mod.imported);
  }

  find(source, imported) {
    let byImported = this.bySource[source];

    if (!byImported) {
      byImported = this.bySource[source] = {};
    }

    return byImported[imported] || null;
  }

  create(source, imported, local) {
    if (this.find(source, imported)) {
      throw new Error(`Module { ${source}, ${imported} } already exists.`);
    }

    let byImported = this.bySource[source];
    if (!byImported) {
      byImported = this.bySource[source] = {};
    }

    let mod = new Module(source, imported, local);
    byImported[imported] = mod;
    this.modules.push(mod);

    return mod;
  }

  get(source, imported, local) {
    let mod = this.find(source, imported, local);
    if (!mod) {
      mod = this.create(source, imported, local);
    }

    return mod;
  }

  hasSource(source) {
    return source in this.bySource;
  }
}

class Module {
  constructor(source, imported, local) {
    this.source = source;
    this.imported = imported;
    this.local = local;
    this.node = null;
  }
}

class GlobalAlias {
  constructor(identifier, emberPath) {
    this.identifier = identifier;
    this.emberPath = emberPath;
  }
}

class Replacement {
  constructor(nodePath, mod) {
    this.nodePath = nodePath;
    this.mod = mod;
  }
}

class Mapping {
  constructor([source, imported, local], registry) {
    this.source = source;
    this.imported = imported || "default";
    this.local = local;
    this.registry = registry;
  }

  getModule() {
    return this.registry.get(this.source, this.imported, this.local);
  }
}
