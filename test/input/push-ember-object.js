import Ember from 'ember';

export default Ember.Component.extend({
  pollMultiOptions: Ember.computed('someArray.[]', function() {
    const options = Ember.A([]);

    this.get('someArray').forEach(function(option) {
      options.push(Ember.Object.create({
        content: option.get('content'),
      }));
    });

    return options;
  })
});
