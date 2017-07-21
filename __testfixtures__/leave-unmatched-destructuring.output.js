import { camelize } from '@ember/string';
import Ember from 'ember';

const {
  String: {
    pluralize
  }
} = Ember;

pluralize('one');
camelize('two');
