import Controller, { inject as controller } from '@ember/controller';
import { inject as service } from '@ember/service';
import { computed } from "@ember/object";
import { alias } from '@ember/computed';

export default Controller.extend({
  controller: controller('application'),
  router: service('router'),
  anotherRouter: alias('router'),
  someComputedProperty: computed(function() { return true; })
});
