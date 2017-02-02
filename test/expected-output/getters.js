import {
  computed,
  get,
  getProperties,
  getWithDefault
} from "@ember/object";
import Component from "@ember/component";
export default Component.extend({
  someComputed: computed('a', 'b', 'c', 'd', function() {
    const a = get(this, 'a');
    const e = getProperties(this, 'a', 'b', 'c');
    const f = get(get(this, 'd'), 'g');
    const h = get(f, 'i');
    const j = getProperties(h, 'k', 'l', 'm');
    const n = get(this, 'o');
    const p = getProperties(this, 'q', 'r');
    const s = getWithDefault(this, 't', 'u');
    const v = get(h, 'w');

    return a + getWithDefault(this, 'b', 'test');
  }),
});
