import Ember from 'ember';

export default Ember.Component.extend({
  a: Ember.testing ? 1 : 2,
});
