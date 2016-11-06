# Ember Modules Codemod

This codemod uses [`jscodeshift`](https://github.com/facebook/jscodeshift) to update an Ember application to
import framework code using module syntax, as proposed in [RFC 176: JavaScript Module API](https://github.com/emberjs/rfcs/pull/176). It can update apps that use the global `Ember`, and will eventually also support
apps using [ember-cli-shims][shims].

[shims]: https://github.com/ember-cli/ember-cli-shims

For example, it will rewrite code that looks like this:

```js
export default Ember.Component.extend({
  isAnimal: Ember.computed.or('isDog', 'isCat')
});
```

Into this:

```js
import Component from "@ember/component";
import { or } from "@ember/object/computed"

export default Component.extend({
  isAnimal: or('isDog', 'isCat')
});
```

## Usage

**This package requires Node 6 or later. Make sure you are using a newer version
of Node before installing and running this package.**

**WARNING**: `jscodeshift`, and thus this codemod, **edit your files in place**.
It does not make a copy. Make sure your code is checked into a source control
repository like Git and that you have no outstanding changes to commit before
running this tool.

The simplest way to use the codemod is like this:

```sh
npm install ember-modules-codemod -g
cd my-ember-app
ember-modules-codemod
```

#### Unknown Globals

If the codemod finds a use of the `Ember` global it doesn't know how to
translate, it will write a report to `MODULE_REPORT.md`. You can use this report
as the basis for filing support issues or contributing to the RFC.

#### Standalone

This package includes an `ember-modules-codemod` binary that wraps `jscodeshift`
and invokes it with the correct configuration when inside the root directory of
an Ember app.

If you're comfortable with `jscodeshift` already or would rather use it
directly, you can clone this repository and invoke the transform manually:

```sh
npm install jscodeshift -g
git clone https://github.com/tomdale/ember-modules-codemod
cd my-ember-app
jscodeshift -t ../ember-modules-codemod/transform.js app
```

Note that invoking the transform directly disables the generation of the
Markdown report if any unknown globals are discovered.

### Maybe Helpful Scripts

I put a few scripts that I found useful while writing the RFC inside the
`scripts` directory. Perhaps they will be useful for you as well.

#### Generate Globals-to-Module Markdown Table

Generates a Markdown-compatible table of globals and their updated module version, and
prints it to `stdout`.

```sh
scripts/generate-markdown-table | pbcopy
```

#### Generate Modules-by-Package Markdown Table

Generates a Markdown-compatible table of modules, grouped by package, and their
global equivalent, and prints it to `stdout`.

```sh
scripts/generate-by-module-markdown-table | pbcopy
```

#### Generate Package List

Scans `mapping.json` and builds a list of all unique top-level package names,
then prints it to `stdout`.

```sh
scripts/generate-package-list | pbcopy
```

## Contributing

### Running Tests

```sh
npm test
```

Tests for this codemod work by comparing two directories:

* `test/input`
* `test/expected-output`

Pre-transform files should go in `input`, expected output after the transform
should go in `expected-output`. Files must be named identically so they can be
compared.

### Transform Bugs

If you discover a file in your app that the codemod doesn't handle well, please
consider submitting either a fix or a failing test case.

First, add the file to the `test/input/` directory. Then, make another file with
the identical name and put it in `test/expected-output/`. This file should
contain the JavaScript output you would expected after running the codemod.

For example, if the codemod fails on a file in my app called
`app/components/my-component.js`, I would copy that file into this repository as
`test/input/my-component.js`. Ideally, I will edit the file to the smallest
possible test case to reproduce the problem (and, obviously, remove any
proprietary code!). I might also wish to give it a more descriptive name, like
`preserve-leading-comment.js`.

Next, I would copy *that* file into `test/input/my-component.js`, and hand apply
the transformations I'm expecting.

Then, run `npm test` to run the tests using Mocha. The tests will automatically
compare identically named files in each directory and provide a diff of the
output if they don't match.

Lastly, make changes to `transform.js` until the tests report they are passing.

If you are submitting changes to the transform, please include a test case so we
can ensure that future changes do not cause a regression.

### Module Changes

If you want to change how globals are mapped into modules, you will find
the data structure that controls that in `config/mapping.json`. The structure
is:

```js
{
  "globalPath": ["moduleName", "namedExport"?, "localName"?]
}
```

Only the first item in the array is mandatory. The second item is only needed
for named exports. The third item is only necessary if the local identifier the
import is bound to should be different than named export (or the previous global
version, in the case of default exports).

A few examples:

1. `Ember.Application` ⟹ `"Application": ["ember-application"]` ⟹ `import Application from "ember-application"`
1. `Ember.computed.or` ⟹ `"computed.or": ["ember-object/computed", "or"]` ⟹ `import { or } from "ember-object/computed"`
1. `Ember.DefaultResolver` ⟹ `"DefaultResolver": ["ember-application/globals-resolver", null, "GlobalsResolver"]` ⟹ `import GlobalsResolver from "ember-application/globals-resolver"`

### Reserved Words

In some cases, Ember's names may conflict with names built in to the language.
In those cases, we should not inadvertently shadow those identifiers.

```js
import Object from "ember-object";

// ...later
Object.keys(obj);
// oops! TypeError: Object.keys is not a function
```

A list of reserved identifiers (including `Object`) is included in
`config/reserved.json`. Anything that appears in this list will be prefixed with
`Ember`; so, for example, `import Object from "ember-object"` would become
`import EmberObject from "ember-object"`.

### Known Issues

There are some limitations in the current implementation that can hopefully be
addressed in the future. PRs welcome!

* Apps using `ember-cli-shims` are not updated.
* All long imports are beautified, even non-Ember ones.
* Destructured assignment to the Ember global is not handled (e.g. `const { underscore } = Ember`).
* Namespace imports (`import * as bar from "foo"`) are not supported.
