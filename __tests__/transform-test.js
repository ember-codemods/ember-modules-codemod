'use strict';

const fs = require("fs");
const defineTest = require('jscodeshift/dist/testUtils').defineTest;

const fixturesPath = `${__dirname}/../__testfixtures__`;

fs.readdirSync(fixturesPath).forEach(fixture => {
  let match = fixture.match(/(.*)\.input\.js$/);
  if (match) {
    defineTest(__dirname, 'transform', {}, match[1]);
  }
});
