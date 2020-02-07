
/**
  * `price-availability-changed`
  * 
  *   Handles displaying items to the user that have recent price changes or 
  * 	on-hand quantities that can no longer fulfill the current order.
  *
  * 	Showes a modal with choices provided to user on how to proceed with the order.
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
import {
  listen, 
  schedule,
  wait
}                  from '@longlost/utils/utils.js';
import htmlString  from './price-availability-changed.html';
import '@longlost/app-overlays/app-header-overlay.js';
import '@longlost/app-overlays/app-modal.js';
import '@polymer/paper-button/paper-button.js';
import './sync-label.js';


const getSyncSymbol = item => {
  const symbols = Object.getOwnPropertySymbols(item);
  return symbols.find(symbol => item[symbol] === 'itemsSyncSymbol');
};

const makeLabels = (slotteds, changes) => {
  // associate price and availability change data to each slotted element
  const labels = slotteds.map(slotted => {
    // take the last price change and last quantity change, ignore prior changes
    const label = changes.reduce((accum, change) => {
      const {kind} = change;
      const slottedSymbol = getSyncSymbol(slotted.item);
      const changeSymbol  = getSyncSymbol(change.item);
      if (slottedSymbol === changeSymbol) {
        accum[kind] = change;
      }
      return accum;
    }, {});
    return {label, slotted};
  });
  return labels;
};


class PriceAvailabilityChanged extends AppElement {
  static get is() { return 'price-availability-changed'; }
  
  static get template() {
    return html([htmlString]);
  }


  static get properties() {
    return {
      // passed in by items-sync.js __setSlottedItems method
      // used to avoid infinite loop when slotted elements change
      canSetNewLabels: Boolean,
 
      changes: Array,

      _andStr: {
        type: String,
        computed: '__computeAndStr(_priceAndQtyChanges)'
      },

      _hasStr: {
        type: String,
        computed: '__computeHasStr(_priceAndQtyChanges)'
      },

      _headingStr: {
        type: String,
        computed: '__computeHeadingStr(_priceAndQtyChanges)'
      },

      _itemStr: {
        type: String,
        computed: '__computeItemStr(_priceAndQtyChanges)'
      },

      _modalOpen: Boolean,

      _overlayOpen: Boolean,

      _priceAndQtyChanges: {
        type: Object,
        computed: '__computePriceAndQtyChanges(changes)'
      },

      _priceStr: {
        type: String,
        computed: '__computePriceStr(_priceAndQtyChanges.priceChanges)'
      },

      _qtyStr: {
        type: String,
        computed: '__computeQtyStr(_priceAndQtyChanges.qtyChanges)'
      },

      _slottedItems: Array,

      _theStr: {
        type: String,
        computed: '__computeTheStr(_priceAndQtyChanges)'
      }

    };
  }


  connectedCallback() {
    super.connectedCallback();

    listen(this.$.slot, 'slotchange', this.__decorateSlottedItemsWithChangeLabels.bind(this));
  }


  __computePriceAndQtyChanges(changes) {
    if (!changes) { return; }   
    const priceChanges = changes.filter(change => change.kind === 'price');
    const qtyChanges   = changes.filter(change => change.kind === 'quantity');
    return {priceChanges, qtyChanges};
  }


  __computeAndStr(obj) {
    if (!obj) { return ''; }
    const {priceChanges, qtyChanges} = obj;
    if (priceChanges.length && qtyChanges.length) { return 'and '; }
    return '';
  }


  __computeHasStr(obj) {
    if (!obj) { return ''; }
    const {priceChanges, qtyChanges} = obj;
    if (!priceChanges.length && !qtyChanges.length) { return ''; }
    if (priceChanges.length === 1 && qtyChanges.length === 1) {
      return 'has ';
    }
    return 'have ';
  }


  __computeHeadingStr(obj) {
    if (!obj) { return ''; }
    const {priceChanges, qtyChanges} = obj;
    return [...priceChanges, ...qtyChanges].length === 1 ? 
      'item has' : 'items have';
  }


  __computeItemStr(obj) {
    if (!obj) { return ''; }
    const {priceChanges, qtyChanges} = obj;
    return [...priceChanges, ...qtyChanges].length === 1 ? 
      'an item' : 'some items';
  }


  __computePriceStr(changes) {
    if (!changes || !changes.length) { return ''; }     
    return changes.length === 1 ? 
      'The price ' : 'Prices ';
  }


  __computeQtyStr(changes) {
    if (!changes || !changes.length) { return ''; }  
    return changes.length === 1 ? 
      'in stock quantity ' : 'in stock quantities ';
  }


  __computeTheStr(obj) {
    if (!obj) { return ''; }
    const {priceChanges, qtyChanges} = obj;
    if (!priceChanges.length && qtyChanges.length) { return 'The '; }
    return '';
  }


  __computeProceedBtnHidden(qtyChanges) {
    if (!qtyChanges || !qtyChanges.length) { return true; }
    return qtyChanges.every(change => Number(change.dbVal) < 1);
  }
  // add labels to each slotted element so it is clear to the user
  // what is different so they can make a more informed choice 
  // before continuing with the purchase
  __decorateSlottedItemsWithChangeLabels() { 
    if (!this.canSetNewLabels) { return; }
    this.canSetNewLabels = false;

    const nodes = this.slotNodes('#slot');
    const slotteds = nodes.filter(node => 
      node.tagName !== undefined && 
      node.tagName !== 'DOM-REPEAT' &&
      node.id      !== 'slotItemLabel'
    );

    if (!slotteds.length) { return; }
    // remove all previous labels
    const oldLabels = nodes.filter(node => 
      node.id === 'slotItemLabel');
    oldLabels.forEach(node => {
      node.remove();
    });
    // associate price and availability change data to each slotted element
    const labels = makeLabels(slotteds, this.changes);
    // add label dom clones
    // cached slotted elements to be measured after open
    // these measurements will be passed into each label clone
    // so the disabled cover can be applied over each slotted el
    this._slottedItems =labels.map(obj => 
      Object.assign(
        {}, 
        obj, 
        {clone: this.$.slotItemLabel.cloneNode(true)}
      ));
    // add clones of sync-label to each slotted element
    // set change data to each clone
    this._slottedItems.forEach(({clone, label, slotted}) => {
      clone.label = label;
      slotted.parentElement.insertBefore(clone, slotted);
    });
  }


  __measureSlottedItems() {
    if (!this._slottedItems) { return; }
    this._slottedItems.forEach(({clone, slotted}) => {
      clone.measurements = slotted.getBoundingClientRect();      
    });
  }


  __openModal() {
    if (this._modalOpen || this._overlayOpen) { return Promise.resolve(); }
    this._modalOpen = true;
    return this.$.modal.open();
  }


  __closeModal() {
    if (!this._modalOpen) { return; }
    this._modalOpen = false;
    return this.$.modal.close();
  }


  __openOverlay() {
    if (this._overlayOpen) { return Promise.resolve(); }
    this._overlayOpen = true;
    return this.$.overlay.open();
  }


  __closeOverlay() {
    if (!this._overlayOpen) { return; }
    this._overlayOpen = false;
    return this.$.overlay.close();
  }


  async __modalButtonClicked() {
    try {
      await this.clicked();
      await this.__closeModal();
      await this.__openOverlay();
      this.__measureSlottedItems();
    }
    catch (error) {
      if (error === 'click debounced') { return; }
      console.error(error);
    }
  }


  async __proceedWithChangesButtonClicked() {
    try {
      await this.clicked();      
      this.fire('proceed-with-changes', {changes: this.changes});
      await wait(50); // give generous time to do work
      this.__closeOverlay();
    }
    catch (error) {
      if (error === 'click debounced') { return; }
      console.error(error);
    }
  }


  async __editOrderButtonClicked() {
    try {
      await this.clicked();      
      this.fire('edit-order', {changes: this.changes});
      await wait(50); // give generous time to do work before closing checkout overlays
      this.__closeOverlay();
    }
    catch (error) {
      if (error === 'click debounced') { return; }
      console.error(error);
    }
  }


  async __cancelOrderButtonClicked() {
    try {
      await this.clicked();
      this.fire('cancel-order', {changes: this.changes});
      await wait(50); // give generous time to do work before closing cart and checkout overlays
      this.__closeOverlay();
    }
    catch (error) {
      if (error === 'click debounced') { return; }
      console.error(error);
    }
  }


  async openModal() {
    await schedule();
    return this.__openModal();
  }
  
}

window.customElements.define(PriceAvailabilityChanged.is, PriceAvailabilityChanged);
