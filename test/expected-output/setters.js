import { get, set, setProperties } from "@ember/object";
import Component from "@ember/component";
export default Component.extend({
  someFunc(a) {
    set(this, 'fooProperty', 'bar');
    setProperties(this, { foo: 'bar', baz: 'qux' });
    set(a, 'fooProperty', 'bar');
    setProperties(a, { foo: 'bar', baz: 'qux' });
    set(get(this, 'b'), 'c', 'bar');
  },
});
