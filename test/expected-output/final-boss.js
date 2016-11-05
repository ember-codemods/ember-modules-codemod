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
import EmberArray from "@ember/array";

import Component from "@ember/component";
import FemberObject, { computed } from "@ember/object";
import { or as bore, and } from "@ember/object/computed";

let bar = foo.Ember.computed.or;

export default FemberObject.extend({
  postCountsPresent: bore('topic.unread', 'topic.displayNewPosts'),
  showBadges: and('postBadgesEnabled', 'postCountsPresent')
});

export default Component.extend({
  topicExists: bore('topic.foo', 'topic.bar')
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