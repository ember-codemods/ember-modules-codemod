import Component from '@ember/component';
import Ember from 'ember';

export default Component.extend({
  a: Ember.testing ? 1 : 2,
});
