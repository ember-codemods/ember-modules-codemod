//  Test cases:
//  * This comment gets preserved at the top of the file.
//  * Re-uses existing aliases if already specified
//  * Chooses appropriate alias if not specified
//  * Renames local name if it conflicts with a reserved word like Object
//  * Uses renamed local name if it already exists
//  * Adds default export to named exports if they already exist
//  * Adds named exports to default export if it already exists
//  * Handles ambiguous cases (computed.or _and_ computed)
//  * Variables named `Ember` are not considered
//  * Manual aliasing (`var Component = Ember.Component` is removed)
//  * `Ember` must be the root of property lookups (no `foo.Ember.bar`)
//  * Deep destructured aliases are resolved (`String.underscore`)
//  * Renamed destructured aliases are preserved (`get: myGet`)
//  * Fully modularized destructuring statements are removed
import EmberArray from '@ember/array';

import { underscore } from '@ember/string';
import Component from '@ember/component';
import FemberObject, {
  get as myGet,
  computed
} from "@ember/object";
import { or as bore, and } from "@ember/object/computed";

let bar = foo.Ember.computed.or;

export default FemberObject.extend({
  postCountsPresent: bore('topic.unread', 'topic.displayNewPosts'),
  showBadges: and('postBadgesEnabled', 'postCountsPresent')
});

export default Component.extend({
  topicExists: bore('topic.foo', 'topic.bar'),
  topicSlug: computed(function() {
    return underscore(myGet(this, 'topic.name'));
  })
});

(function() {
  let Ember = {};
  Ember.Component = class Component {
  };
})();

export default EmberArray.extend({
  firstName: computed(function(foo) {
  })
});
