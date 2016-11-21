import { on as onEvent } from "@ember/object/evented";
import { run } from "@ember/runloop";
import { isEmpty, isNone } from "@ember/utils";
import $ from "jquery";
import { computed, observer, get } from "@ember/object";
import { readOnly } from "@ember/object/computed";
import Component from "@ember/component";
import Ember from 'ember';
//unused module should be removed, along with leading comment
import layout from '../templates/component/destructured-declaration';

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
