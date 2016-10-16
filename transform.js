const mappings = require("./mapping");
const j = require("jscodeshift");

class Module {
  constructor(source, imported, local) {
    this.source = source;
    this.imported = imported;
    this.local = local;
    this.node = null;
  }

  isEqual(otherModule) {
    return this.source === otherModule.source
      && this.imported === otherModule.imported;
  }
}

class Replacement {
  constructor(nodePath, mapping) {
    this.nodePath = nodePath;
    this.mapping = mapping;
  }
}

class Mapping {
  constructor([source, imported, local]) {
    this.mod = new Module(source, imported || "default", local);
    this.replacements = [];
  }
}

for (let mapping of Object.keys(mappings)) {
  mappings[mapping] = new Mapping(mappings[mapping]);
}

module.exports = function (file, api, options) {
  let source = file.source;
  let j = api.jscodeshift;

  let root = j(file.source);
  let body = root.get().value.program.body;

  let replacements = root.find(j.MemberExpression, { object: { name: "Ember" } })
    .filter(isEmberGlobal)
    .paths()
    .map(findReplacement);

  let usedModules = findModulesUsedInReplacements(replacements);
  let existingModules = findExistingModules(root);

  updateOrCreateImportDeclarations(root, usedModules, existingModules);

  // importModules(root, modules);

  return root.toSource();

  function findReplacement(path) {
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

    if (!mapping.mod.local) {
      // Ember.computed.or => or
      mapping.mod.local = propertyPath.split(".").slice(-1)[0];
    }

    let replacement = new Replacement(nodePath, mapping);
    mapping.replacements.push(replacement);

    return replacement;

    // j(memberPath)
    //   .replaceWith(j.identifier(identifier));

    // modules.push([pkg, exportName, identifier]);
  }
}

function updateOrCreateImportDeclarations(root, usedModules, existingModules) {
  usedModules.forEach(usedMod => {
    let bySource;

    if (bySource = findExisting(usedMod)) {
      if (!bySource[usedMod.imported]) {
        let specifier = j.importSpecifier(usedMod.imported, usedMod.local);
        root.find(j.ImportDeclaration, {
          source: { value: usedMod.source }
        }).get("specifiers").push(specifier);
      }
    }
  });

  function findExisting(mod) {
    return existingModules[mod.source];
  }
}

function findModulesUsedInReplacements(replacements) {
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
  let modulesBySource = {};

  root
    .find(j.ImportDeclaration)
    .forEach(({ node }) => {
      let source = node.source.value;
      let byImported = modulesBySource[source];
      if (!byImported) {
        byImported = modulesBySource[source] = {};
      }

      node.specifiers.forEach(spec => {
        let imported;
        if (j.ImportDefaultSpecifier.check(spec)) {
          imported = "default";
        } else {
          imported = spec.imported.name;
        }

        let seenModule = byImported[imported];
        if (!seenModule) {
          let mod = new Module(source, imported, spec.local.name);
          mod.node = node;
          byImported[imported] = mod;
        }
      });
    });

  return modulesBySource;

  // let importStatement = createImportStatement(pkg, identifier, exportName);
  // addImport(body, importStatement);
}

function addImport(body, importStatement) {
  body.unshift(importStatement);
  body[0].comments = body[1].comments;
  delete body[1].comments;
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
function createImportStatement(moduleName, variableName, propName) {
  var declaration, variable, idIdentifier, nameIdentifier;
  // console.log('variableName', variableName);
  // console.log('moduleName', moduleName);

  // if no variable name, return `import 'jquery'`
  if (!variableName) {
    declaration = j.importDeclaration([], j.literal(moduleName));
    return declaration;
  }

  // multiple variable names indicates a destructured import
  if (Array.isArray(variableName)) {
    var variableIds = variableName.map(function (v) {
      return j.importSpecifier(j.identifier(v), j.identifier(v));
    });

    declaration = j.importDeclaration(variableIds, j.literal(moduleName));
  } else {
    // else returns `import $ from 'jquery'`
    nameIdentifier = j.identifier(variableName); //import var name
    variable = j.importDefaultSpecifier(nameIdentifier);

    // if propName, use destructuring `import {pluck} from 'underscore'`
    if (propName) {
      idIdentifier = j.identifier(propName);
      variable = j.importSpecifier(idIdentifier, nameIdentifier); // if both are same, one is dropped...
    }

    declaration = j.importDeclaration([variable], j.literal(moduleName));
  }

  return declaration;
}

function isEmberGlobal(path) {
  return !path.scope.declares("Ember");
}