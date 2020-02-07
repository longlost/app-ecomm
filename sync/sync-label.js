
/**
  * `sync-label`
  * 
  *   A price and qty label that covers slotted items
  * 	to show the user what changes have occured.
  *
  *
  *
  *  
  *
  * @customElement
  * @polymer
  * @demo demo/index.html
  *
  **/


import {
  AppElement, 
  html
}                  from '@longlost/app-element/app-element.js';
import htmlString  from './sync-label.html';


class SyncLabel extends AppElement {
  static get is() { return 'sync-label'; }
  
  static get template() {
    return html([htmlString]);
  }


  static get properties() {
    return {
      
      label: Object,
      // slotted item bounding client rect obj
      measurements: Object

    };
  }


  static get observers() {
    return [
      '__measurementsChanged(measurements)'
    ];
  }


  __computeHidden(val) {
    return val === undefined;
  }
  // set measurements so the cover is only covering the slotted item
  // the translucent cover also captures all pointer-events
  __measurementsChanged(obj) {
    if (!obj) { return; }
    const {height, width}    = obj;
    const {height: coverTop} = this.getBoundingClientRect();
    const toPix = num => `${num}px`;
    this.$.foreground.style.top    = toPix(coverTop);
    this.$.foreground.style.height = toPix(height);
    this.$.foreground.style.width  = toPix(width);
  }
  
}

window.customElements.define(SyncLabel.is, SyncLabel);
