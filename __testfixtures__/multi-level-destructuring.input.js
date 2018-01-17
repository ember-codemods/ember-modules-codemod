import Ember from 'ember';
const { computed } = Ember;
const { oneWay } = computed;

export default Ember.Component.extend({
  name: oneWay('userName')
})
