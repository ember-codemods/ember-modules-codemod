import { A } from "@ember/array";
import EmberObject, { computed } from "@ember/object";
import Component from "@ember/component";

export default Component.extend({
  pollMultiOptions: computed('someArray.[]', function() {
    const options = A([]);

    this.get('someArray').forEach(function(option) {
      options.push(EmberObject.create({
        content: option.get('content'),
      }));
    });

    return options;
  })
});
