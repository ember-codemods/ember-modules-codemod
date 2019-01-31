#!/usr/bin/env node
'use strict';

const fs = require("fs");
const execa = require('execa');
const chalk = require("chalk");
const path = require("path");
const glob = require("glob");

let cwd = process.cwd();
let pkgPath = path.join(cwd, 'package.json');

try {
  let pkg = JSON.parse(fs.readFileSync(pkgPath));
  if (!isEmberApp(pkg)) {
    notAnEmberApp("I couldn't find ember-cli in the dependencies of " + pkgPath);
  }

  let binPath = path.dirname(require.resolve("jscodeshift")) + "/bin/jscodeshift.sh";
  let transformPath = __dirname + "/../transform.js";
  let env = Object.assign({
    EMBER_MODULES_CODEMOD: true
  }, process.env);

  const args = process.argv;
  let jscodeshiftPaths;
  if (args[2]) {
    jscodeshiftPaths = [args[2]];
  } else {
    jscodeshiftPaths = ["app", "addon", "addon-test-support", "tests", "test-support", "lib"];
  }
  const jscodeshiftArgs = ["-t", transformPath].concat(jscodeshiftPaths);

  let transform = execa(binPath, jscodeshiftArgs, {
    stdio: "inherit",
    env: env
  });

  // Generate MODULE_REPORT.md when jscodeshift is done running.
  transform.on("exit", buildReport);
} catch (e) {
  if (e.code === "ENOENT") {
    notAnEmberApp("I couldn't find a package.json at " + pkgPath);
  } else {
    console.error(chalk.red(e.stack));
    process.exit(-1);
  }
}

function isEmberApp(pkg) {
  return contains("ember-cli", pkg.devDependencies) || contains("ember-cli", pkg.dependencies);
}

function contains(key, object) {
  if (!object) { return false; }
  return key in object;
}

function notAnEmberApp(msg) {
  console.error(chalk.red("It doesn't look like you're inside an Ember app. " + msg));
  process.exit(-1);
}

// Each worker process in jscodeshift will write to a file with its pid used to
// make the path unique. This post-transform step aggregates all of those files
// into a single Markdown report.
function buildReport() {
  let report = [];

  // Find all of the temporary logs from the worker processes, which contain a
  // serialized JSON array on each line.
  glob("ember-modules-codemod.tmp.*", (err, logs) => {
    // If no worker found an unexpected value, nothing to report.
    if (!logs) {
      return;
    }

    // For each worker, split its log by line and eval each line
    // as JSON.
    logs.forEach(log => {
      let logText = fs.readFileSync(log);
      logText
        .toString()
        .split("\n")
        .forEach(line => {
          if (line) {
            try {
              report.push(JSON.parse(line));
            } catch (e) {
              console.log("Error parsing " + line);
            }
          }
        });

      // Delete the temporary log file
      fs.unlinkSync(log);
    });

    // If there's anything to report, convert the JSON tuple into human-formatted
    // markdown and write it to MODULE_REPORT.md.
    if (report.length) {
      report = report.map(line => {
        let type = line[0];
        if (type === 1) {
          return runtimeErrorWarning(line);
        } else {
          return unknownGlobalWarning(line);
        }
      });

      let file = "## Module Report\n" + report.join("\n");

      // normalize line endings, so we don't end up with mixed
      file = file.replace(/\r?\n/g, require('os').EOL);

      fs.writeFileSync("MODULE_REPORT.md", file);
      console.log(chalk.yellow("\nDone! Some files could not be upgraded automatically. See " + chalk.blue("MODULE_REPORT.md") + "."));
    } else {
      console.log(chalk.green("\nDone! All uses of the Ember global have been updated."));
    }
  });
}

function runtimeErrorWarning(line) {
  let path = line[1];
  let source = line[2];
  let err = line[3];

  return `### Runtime Error

**Path**: \`${path}\`

**Error**:

\`\`\`
${err}
\`\`\`

**Source**:

\`\`\`js
${source}
\`\`\`
`;
}

function unknownGlobalWarning(line) {
  let global = line[1];
  let lineNumber = line[2];
  let path = line[3];
  let context = line[4];

  return `### Unknown Global

**Global**: \`Ember.${global}\`

**Location**: \`${path}\` at line ${lineNumber}

\`\`\`js
${context}
\`\`\`
`;
}
