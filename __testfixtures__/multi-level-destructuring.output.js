import Component from '@ember/component';
import { camelize } from '@ember/string';
import { inject as service } from '@ember/service';
import { oneWay } from '@ember/object/computed';

export default Component.extend({
  barService: service('bar'),
  name: oneWay('userName'),
  foo() {
    camelize('bar');
  }
});
