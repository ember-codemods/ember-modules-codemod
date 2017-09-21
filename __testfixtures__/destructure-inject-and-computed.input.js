import Ember from 'ember';
const { inject, computed } = Ember;

export default Ember.Controller.extend({
  controller: inject.controller('application'),
  router: inject.service('router'),
  anotherRouter: computed.alias('router'),
  someComputedProperty: computed(function() { return true; }),
  someInvalidMacro: computed.foo('bar')
});

function notRelated() {
  const computed = new SomeThing();

  return {
    foo: computed.not('bar')
  };
}
