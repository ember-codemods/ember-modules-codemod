import Component from '@ember/component';
import { oneWay } from '@ember/object/computed';

export default Component.extend({
  name: oneWay('userName')
})
