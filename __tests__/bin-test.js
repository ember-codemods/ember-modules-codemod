'use strict';

const path = require('path');
const fs = require('fs-extra');
const cp = require('child_process');
const tmp = require('tmp');

describe('bin acceptance', function() {
  let tmpPath;

  beforeEach(function() {
    tmpPath = tmp.dirSync().name;

    fs.ensureDirSync(path.join(tmpPath, 'app'));

    fs.writeJsonSync(path.join(tmpPath, 'package.json'), {
      devDependencies: {
        'ember-cli': ''
      }
    });
  });

  it('works', function() {
    let inputFile = path.join(process.cwd(), '__testfixtures__/final-boss.input.js');
    let outputFile = path.join(process.cwd(), '__testfixtures__/final-boss.output.js');
    let tmpFile = path.join(tmpPath, 'app/final-boss.js');

    fs.copySync(
      path.join(process.cwd(), '__testfixtures__/final-boss.input.js'),
      tmpFile
    );

    cp.spawnSync('node', [
      path.join(process.cwd(), 'bin/ember-modules-codemod')
    ], {
      cwd: tmpPath,
      stdio: 'inherit'
    });

    expect(fs.readFileSync(tmpFile, 'utf8')).toEqual(fs.readFileSync(outputFile, 'utf8'));
  });
});
