'use strict';

const path = require('path');
const fs = require('fs-extra');
const cp = require('child_process');
const tmp = require('tmp');

const inputFile = path.join(process.cwd(), '__testfixtures__/final-boss.input.js');
const outputFile = path.join(process.cwd(), '__testfixtures__/final-boss.output.js');

describe('bin acceptance', function() {
  let tmpPath;
  let tmpFile;
  let tmpPackageJson;

  beforeEach(function() {
    tmpPath = tmp.dirSync().name;

    tmpPackageJson = path.join(tmpPath, 'package.json');

    fs.ensureDirSync(path.join(tmpPath, 'app'));

    tmpFile = path.join(tmpPath, 'app/final-boss.js');

    fs.copySync(
      path.join(process.cwd(), '__testfixtures__/final-boss.input.js'),
      tmpFile
    );
  });

  it('handles non-ember projects', function() {
    let stderr = '';
    let exitCode;

    return new Promise(resolve => {
      let ps = cp.spawn('node', [
        path.join(process.cwd(), 'bin/ember-modules-codemod')
      ], {
        cwd: tmpPath
      });

      ps.stderr.on('data', data => {
        stderr += data.toString();
      });

      ps.on('exit', (code, signal) => {
        exitCode = code;

        resolve();
      });
    }).then(() => {
      expect(exitCode).not.toEqual(0);

      expect(stderr).toEqual(`It doesn't look like you're inside an Ember app. I couldn't find a package.json at ${tmpPackageJson}\n`);
    });
  });

  describe('with valid package.json', function() {
    beforeEach(function() {
      fs.writeJsonSync(tmpPackageJson, {
        devDependencies: {
          'ember-cli': ''
        }
      });
    });

    it('works', function() {
      cp.spawnSync('node', [
        path.join(process.cwd(), 'bin/ember-modules-codemod')
      ], {
        cwd: tmpPath,
        stdio: 'inherit'
      });

      expect(fs.readFileSync(tmpFile, 'utf8')).toEqual(fs.readFileSync(outputFile, 'utf8'));
    });
  });
});
