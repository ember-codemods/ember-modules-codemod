import { inject as service } from '@ember/service';
import { alias } from '@ember/object/computed';
import Controller, { inject as controller } from '@ember/controller';
import { computed } from '@ember/object';

export default Controller.extend({
  controller: controller('application'),
  router: service('router'),
  anotherRouter: alias('router'),
  someComputedProperty: computed(function() { return true; })
});

function notRelated() {
  const computed = new SomeThing();

  return {
    foo: computed.not('bar')
  };
}
