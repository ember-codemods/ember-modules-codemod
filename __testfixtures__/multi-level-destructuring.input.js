import Ember from 'ember';

const { computed, inject, String } = Ember;
const { oneWay } = computed;
const { service } = inject;
const { camelize } = String;

export default Ember.Component.extend({
  barService: service('bar'),
  name: oneWay('userName'),
  foo() {
    camelize('bar');
  }
});
