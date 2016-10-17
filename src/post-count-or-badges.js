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
import FemberObject from "ember-object";
import { or as bore } from "ember-object/computed";

export default Ember.Object.extend({
  postCountsPresent: Ember.computed.or('topic.unread', 'topic.displayNewPosts'),
  showBadges: Ember.computed.and('postBadgesEnabled', 'postCountsPresent')
});

(function() {
  let Ember = {};
  Ember.Component = class Component {
  };
})();

export default Ember.Array.extend({
  firstName: Ember.computed(function(foo) {
  })
});