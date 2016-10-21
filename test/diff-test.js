const fs = require("fs");
const spawn = require("child_process").spawn;
const temp = require("temp").track();

const inputPath = __dirname + "/input";
const expectedPath = __dirname + "/expected-output";
const jscodeshiftPath = __dirname + "/../node_modules/.bin/jscodeshift";
const transformPath = __dirname + "/../transform.js";
const tempPath = temp.mkdirSync("ember-modules-codemod-tests");

const TIMEOUT = 10000;
const VERBOSE_ENV_VAR = "VERBOSE_JSCODESHIFT";

console.log("Running tests. Run with " + VERBOSE_ENV_VAR + " to see jscodeshift output.");

var files = fs.readdirSync(inputPath)

files.forEach(function(file) {
  copy(inputPath + "/" + file, tempPath + "/" + file);

  it(file + " input and output should match", function(done) {
    this.timeout(TIMEOUT);

    var jscodeshift = spawn(jscodeshiftPath, jscodeshiftArgs(file), {
      stdio: process.env[VERBOSE_ENV_VAR] === "true" ? "inherit" : "ignore",
      cwd: tempPath
    });

    jscodeshift.on("error", function(err) {
      done(err);
    });

    jscodeshift.on("exit", function(code) {
      if (code !== 0) {
        done(new Error("Non-zero exit code from jscodeshift for " + file));
      } else {
        assertFilesEqual(file);
        done();
      }
    });
  });
});

function assertFilesEqual(file) {
  var expected = fs.readFileSync(expectedPath + "/" + file);
  var actual = fs.readFileSync(tempPath + "/" + file);

  if (!actual.equals(expected)) {
    throw new FilesDoNotMatchError(file, actual, expected);
  }
}

function FilesDoNotMatchError(file, actual, expected) {
  this.message = "Expected transformed " + file + " to match.";
  this.actual = actual.toString();
  this.expected = expected.toString();
}

FilesDoNotMatchError.prototype = new Error();

function jscodeshiftArgs(file) {
  return ["-t", transformPath, file];
}

function copy(source, dest) {
  var buf = fs.readFileSync(source);
  fs.writeFileSync(dest, buf);
}