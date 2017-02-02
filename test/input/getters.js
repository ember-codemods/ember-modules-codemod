export default Ember.Component.extend({
  someComputed: Ember.computed('a', 'b', 'c', 'd', function() {
    const a = this.get('a');
    const e = this.getProperties('a', 'b', 'c');
    const f = this.get('d').get('g');
    const h = f.get('i');
    const j = h.getProperties('k', 'l', 'm');
    const n = Ember.get(this, 'o');
    const p = Ember.getProperties(this, 'q', 'r');
    const s = Ember.getWithDefault(this, 't', 'u');
    const v = Ember.get(h, 'w');

    return a + this.getWithDefault('b', 'test');
  }),
});
