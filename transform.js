const fs       = require("fs");
const RESERVED = require("./config/reserved");
const MAPPINGS = require("./config/mapping");

const LOG_FILE = "ember-modules-codemod.tmp." + process.pid;
const ERROR_WARNING = 1;
const MISSING_EXPRESSION_WARNING = 2;
const MISSING_NAMESPACE_WARNING = 3;
const UNSUPPORTED_DESTRUCTURING = 4
const MISSING_GLOBAL_WARNING = 5;

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

    // Scan the source code, looking for any instances of the `Ember` identifier
    // used as the root of a property lookup. If they match one of the provided
    // mappings, save it off for replacement later.
    let replacements = findUsageOfEmberGlobal(root)
      .map(findReplacement(mappings));



    // Actually go through and replace each usage of `Ember.whatever` with the
    // imported binding (`whatever`).
    applyReplacements(replacements);



    // Lookup for declarations of variables from the global ember namespace
    // i.e. : `const {computed} = Ember`
    let propertyDeclarations = findDestructuringOfNamespace(root, 'Ember');

    // Go through all properties declared and look for a proper replacement
    propertyDeclarations.forEach(function(path){
      path.node.declarations[0].id.properties.forEach((property)=>{

        // We do not support nested declarations yet. Skip it.
        // i.e. const {computed: {readOnly}} = Ember;
        if(property.value.properties){
          let context = extractSourceContext(path);
          let lineNumber = path.value.loc.start.line;
          warnings.push([UNSUPPORTED_DESTRUCTURING, property.key.name, lineNumber, file.path, context]);

          return;
        }

        // Check if property is used as a namespace.
        let usageOfNamespace = findUsageOfDestructuredNamespace(root)(property);

        // If used as namespace, find the most suitable
        // replacement for either the namespace or the namespace
        // propcerty used in the statement. i.e.
        // `readOnly` for `computed.readOnly`
        // `computed` for `computed.unknownModule`
        let namespaceReplacements = usageOfNamespace.reduce(findNamespaceReplacement(property, mappings), []);

        // Mark this namespace declaration for prune if it is not used
        // or we can replace it everywhere
        if (usageOfNamespace.length === 0 ||
            usageOfNamespace.length === namespaceReplacements.length){
          property['markedForDelete'] = true;
        }

        // Actually replace namespace usages
        applyReplacements(namespaceReplacements);

        // Try to replace usages of module as an expression/fucntion
        replaceExpression(mappings, property);

      });
    });

    // Remove repleacable variable/namespaces from
    // declaration statements
    cleanupDestructuredDeclarations(propertyDeclarations);

    // Now that we've identified all of the replacements that we need to do, we'll
    // make sure to either add new `import` declarations, or update existing ones
    // to add new named exports or the default export.
    updateOrCreateImportDeclarations(root, modules);


    // jscodeshift is not so great about giving us control over the resulting whitespace.
    // We'll use a regular expression to try to improve the situation (courtesy of @rwjblue).
    source = beautifyImports(root.toSource());
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

  /*
  * Finds all uses of a property looked up on the Ember global (i.e.,
  * `Ember.something`). Makes sure that it is actually the Ember global
  * and not another variable that happens to be called `Ember`.
  */
  function findUsageOfEmberGlobal(root) {
    return root.find(j.MemberExpression, {
      object: {
        name: "Ember"
      }
    })
    .filter(isEmberGlobal(root))
    .paths();
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
        let context = extractSourceContext(path);
        let lineNumber = path.value.loc.start.line;
        warnings.push([MISSING_GLOBAL_WARNING, candidates[candidates.length-1][1], lineNumber, file.path, context]);
        return null;
      }

      let [nodePath, propertyPath] = found;
      let mapping = mappings[propertyPath];

      let mod = mapping.getModule();
      if (!mod.local) {
        // Ember.computed.or => or
        let local = propertyPath.split(".").slice(-1)[0];
        if (includes(RESERVED, local)) {
          // Prevent jshint errors for Capitalized functions
          // (considered as constructors)
          local = mod.imported.charAt(0) === mod.imported.charAt(0).toLowerCase() ? `ember${local}` : `Ember${local}`;
        }
        mod.local = local;
      }

      return new Replacement(nodePath, mod);
    };
  }

  function extractSourceContext(path) {
    let start = path.node.loc.start.line;
    let end = path.node.loc.end.line;

    let lines = source.split("\n");

    start = Math.max(start-2, 1);
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
          } else {
            specifier = j.importSpecifier(j.identifier(imported), j.identifier(local));
          }

          declaration.get("specifiers").push(specifier);
          mod.node = declaration.at(0);
        } else {
          let importStatement = createImportStatement(source, imported, local);
          body.unshift(importStatement);
          body[0].comments = body[1].comments;
          delete body[1].comments;
          mod.node = importStatement;
        }
      } else {
        if(!isUsedModule(root, mod)){
          root.find(j.ImportDeclaration, {
              source: { value: mod.source }
            })
            .remove();
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

  function isEmberGlobal(root) {
    return function(path) {
      return !path.scope.declares("Ember") || root.find(j.ImportDeclaration, {
        specifiers: [{
          type: "ImportDefaultSpecifier",
          local: {
            name: "Ember"
          }
        }],
        source: {
          value: "ember"
        }
      }).size() > 0;
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
              .map(name => `\n  ${name.trim()}`);

        return result + named.join(',') + '\n} from';
      } else {
        // if the segment is < 50 chars just make sure it has proper spacing
        return importStatement
          .replace(/,\s*/g, ', ') // ensure there is a space after commas
          .replace(/\{\s*/, '{ ')
          .replace(/\s*\}/, ' }');
      }
    });
  }


  function findDestructuringOfNamespace(root, namespace){
    return root.find(j.VariableDeclaration, {
      declarations: [{
        init: {
           name: namespace
        }
      }]
    })
    // .filter(isEmberGlobal(root))
    .paths();
  }

  function findUsageOfDestructuredNamespace(root){
    return (property)=>{
      let namespace = property.value;
      return root.find(j.MemberExpression, {
          object: {
            name: namespace.name
          }
        })
        .paths();
    };
  }

  function findUsageOfDestructuredExpression(root){
    return (expression)=>{
      return root.find(j.CallExpression, {
          callee: {
            name: expression
          }
        })
        .paths();
    };
  }

  function findNamespaceReplacement(namespaceDeclaration, mappings){
    return (replacements, path)=>{

      let namespaceAlias = namespaceDeclaration.value.name;
      let namespaceName = namespaceDeclaration.key.name;
      let namespace = path.node.object.name;
      let candidates = expandMemberExpressions(path)
                        .map(decorateNamespaceCandidates(namespace))
                        .concat([[path, namespace]]);

      let found = candidates.find(([_, propertyPath]) => {
        return propertyPath in mappings;
      });
      if(found[1] === namespace){
        // No need for a replacement, just include
        // the corresponding module is enough.
        // Also candidate this namespace for prune
        let mapping = mappings[namespaceName];
        includeModuleFromMappping(mapping, namespaceAlias);

        namespaceDeclaration['markedForDelete'] = true;

      } else if(!found){
        // We don't have a mapping for neither the namespace nor
        // the nested property
        let context = extractSourceContext(path);
        let lineNumber = path.value.loc.start.line;
        warnings.push([MISSING_NAMESPACE_WARNING, candidates[candidates.length-1][1], lineNumber, file.path, context]);
      } else {
        let [nodePath, propertyPath] = found;
        let mapping = mappings[propertyPath];
        let mod = includeModuleFromMappping(mapping, propertyPath.split(".").slice(-1)[0]);

        replacements.push(new Replacement(nodePath, mod));
      }

      return replacements;
    };
  }

  function decorateNamespaceCandidates(namespace){
    return (candidate)=>{
      candidate[candidate.length-1] = `${namespace}.${candidate[candidate.length-1]}`;
      return candidate;
    };
  }

  function isUsedModule(root, module){

    return root.find(j.Identifier, {name: module.local}).size() > 1;
  }

  function cleanupDestructuredDeclarations(declarations){
    declarations.forEach(function(path){
      let keepProps = path.node.declarations[0].id.properties.filter((prop)=>{
        return !prop.markedForDelete;
      });

      if (!keepProps.length){
        path.prune();
      } else {
        path.node.declarations[0].id.properties = keepProps;
      }
    });
  }

  function includeModuleFromMappping(mapping, localModuleAlias){
    let mod = mapping.getModule();
    if (!mod.local) {
      // Ember.computed.or => or
      let local = localModuleAlias;
      if (includes(RESERVED, local)) {
        local = `Ember${local}`;
      }
      mod.local = local;
    }
    return mod;
  }

  function replaceExpression(mappings, propertyDeclaration){
    let propAlias = propertyDeclaration.value.name;
    let propName = propertyDeclaration.key.name;

    let usageOFExpression = findUsageOfDestructuredExpression(root)(propAlias);
    let usageOfDestructuredSubmodules = findDestructuringOfNamespace(root, propAlias);
    let propertyUsedAsExpression = !!usageOFExpression.length || !!usageOfDestructuredSubmodules.length;
    let canReplaceDeclaration = propName in mappings;

    if (!propertyUsedAsExpression){
      // Candidate for delete only if namespace analysis
      // gave the same result
      propertyDeclaration['markedForDelete'] &= true;

    } else if (canReplaceDeclaration){
      let mapping = mappings[propName];
      includeModuleFromMappping(mapping, propAlias);

      propertyDeclaration['markedForDelete'] = true;

    } else {
      let expressionName = propName;
      usageOFExpression.forEach((expressionPath)=>{
        let context = extractSourceContext(expressionPath);
        let lineNumber = expressionPath.value.loc.start.line;
        warnings.push([MISSING_EXPRESSION_WARNING, expressionName, lineNumber, file.path, context]);
      });

      propertyDeclaration['markedForDelete'] = false;
    }
  }
}

function includes(array, value) {
  return array.indexOf(value) > -1;
}

function flatten (list){
  return list.reduce((a, b)=>{
    return a.concat(Array.isArray(b) ? flatten(b) : b), [];
  });
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
