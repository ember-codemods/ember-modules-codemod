export default Ember.Component.extend({
  someFunc(a) {
    this.set('fooProperty', 'bar');
    this.setProperties({ foo: 'bar', baz: 'qux' });
    a.set('fooProperty', 'bar');
    a.setProperties({ foo: 'bar', baz: 'qux' });
    this.get('b').set('c', 'bar');
  },
});
