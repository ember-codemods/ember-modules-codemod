import { on as onEvent } from "@ember/object/evented";
import { isEmpty, isNone } from "@ember/utils";
import $ from "jquery";
import { computed, observer, get } from "@ember/object";
import { readOnly, notEmpty } from "@ember/object/computed";
import Component from "@ember/component";

const { String: { htmlSafe } } = Ember;

export default Component.extend(
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

    text: readOnly('topic.text'),

    hasText: notEmpty('topic.text'),

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
