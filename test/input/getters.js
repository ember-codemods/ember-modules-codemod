export default Ember.Component.extend({
  someComputed: Ember.computed('a', 'b', 'c', 'd', function() {
    const a = this.get('a');
    const e = this.getProperties('a', 'b', 'c');
    const f = this.get('d').get('g');
    const h = f.get('i');
    const j = h.getProperties('k', 'l', 'm');

    return a + this.getWithDefault('b', 'test');
  }),
});
