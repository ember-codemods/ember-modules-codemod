#!/usr/bin/env node

const fs = require("fs");
const spawn = require("child_process").spawn;
const chalk = require("chalk");
const path = require("path");

let cwd = process.cwd();
let pkgPath = cwd + "/package.json";

try {
  let pkg = JSON.parse(fs.readFileSync(pkgPath));
  if (!isEmberApp(pkg)) {
    notAnEmberApp("I couldn't find ember-cli in the dependencies of " + pkgPath);
  }

  let binPath = path.dirname(require.resolve("jscodeshift")) + "/bin/jscodeshift.sh";
  let transformPath = __dirname + "/../transform.js";
  spawn(binPath, ["-t", transformPath, "app/"], {
    stdio: "inherit"
  });
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