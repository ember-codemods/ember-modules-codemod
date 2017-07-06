import Ember from 'ember';
//unused module should be removed, along with leading comment
import layout from '../templates/component/destructured-declaration';

const {
  Component,
  computed,
  $,
  isEmpty,
  observer,
  get,
  isNone,
  run
} = Ember;

const { on: onEvent } = Ember;

const { String: { htmlSafe } } = Ember;

export default Ember.Component.extend(
  {
    topic: null,

    customComputed: computed(
      'topic',
      {
        get() {
          const topic = this.get('topic');
          if(isEmpty(topic)){
            return get(topic, 'text');
          } else {
            return `custom computed text`;
          }

        }
      }
    ),

    text: computed.readOnly('topic.text'),

    // Unknown submodule will force the import of
    // parent namespace
    hasText: run.unknownModule('topic.text'),

    /**
     * common case for fucntion listening to a
     * component lifecycle hook
     */
    __setupListeners: onEvent(
      'didInsertElement',
      function() {
        // this `on` remain unchanged
        $('body').on('eventName', ()=>{});
      }
    ),

    __syncClearInput: observer(
      'topic.text',
      function(){
        const text = this.get('topic.text');
        if( !isNone(text) ){
          this.get('inputEl').val('');
        }
      }
    ),

  }
);
