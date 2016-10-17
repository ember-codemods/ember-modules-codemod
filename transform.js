const reserved = require("./reserved");
const j = require("jscodeshift");

module.exports = function (file, api, options) {
  let source = file.source;
  let j = api.jscodeshift;

  let root = j(file.source);

  let modules = findExistingModules(root);
  let mappings = buildMappings(modules);
  
  let replacements = findUsageOfEmberGlobal(root)
    .map(findReplacement(mappings));

  updateOrCreateImportDeclarations(root, modules);
  applyReplacements(replacements);
  
  source = beautifyImports(root.toSource());

  console.log(source);
  return source;
}

function buildMappings(registry) {
  let mappings = require("./mapping");

  for (let mapping of Object.keys(mappings)) {
    mappings[mapping] = new Mapping(mappings[mapping], registry);
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

function findReplacement(mappings) {
  return function(path) {
    // Expand the full set of property lookups. For example, we don't want
    // just "Ember.computed"—we want "Ember.computed.or" as well.
    let candidates = expandMemberExpressions(path);

    // This will give us an array of tuples ([pathString, node]) that map on to:
    //
    //   [Ember.computed.reads, Ember.computed], or
    //   [Ember.Object.extend, Ember.Object]
    //
    // We'll go through these to find the most specific candidate that matches
    // our global->ES6 map.

    let found = candidates.find(([_, propertyPath]) => {
      return propertyPath in mappings;
    });

    if (!found) {
      console.log("Missing module equivalent: Ember." + candidates[0][1]);
      return null;
    }

    let [nodePath, propertyPath] = found;
    let mapping = mappings[propertyPath];

    let mod = mapping.getModule();
    if (!mod.local) {
      // Ember.computed.or => or
      let local = propertyPath.split(".").slice(-1)[0];
      if (reserved.includes(local)) {
        local = `Ember${local}`;
      }
      mod.local = local;
    }

    return new Replacement(nodePath, mod);
  };
}

function applyReplacements(replacements) {
  replacements
    .filter(r => !!r)
    .forEach(replacement => {
      let local = replacement.mod.local;
      replacement.nodePath
        .replace(j.identifier(local));
    });
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
        let imported = isDefault ? "default" : spec.imported.name;

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