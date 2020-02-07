/**
  * `items-sync`
  *
  *		Synchornize live pricing and on-hand stock quantities for each item subscription.
  * 	Used for items that have frequent price or qty changes.
  *
  * 	Displays labels and notifications if changes occur during the checkout flow.
  *
  *		Fires changes for app-cart to also display labels for price and availability changes.
  * 	
  *
  *  Properties:
  *
  *     
  *     subscriptions: [
  *       { 
  *         coll:         '', // fb collection
  *         dbPricePaths: [], // doc schema ie. ['prices.lowest', 'prices.highest']
  *         dbQtyPaths:   [], // doc schema ie. ['qty', 'large.available']
  *         docProp:      '', // firebase doc id (ie. 'id', 'normalized', 'name')
  *         item:         {}, // item to compare live changes with
  *         matcher:      fn, // function that can guarantee uniqueness amongst items and their changes
  *         pricePaths:   [], // item schema ie. ['prices.lowest', 'prices.highest'] must be same length as dbPricePaths
  *         qtyPaths:     [], // item schema ie. ['qty', 'cartQty', large.available'] must be same length as dbQtyPaths
  *         type:         ''  // reflected back in event detail ie. 'card, event, item, doughnut'
  *       },
  *       { 
  *          ...
  *       }
  *     ]  
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
}                 from '@longlost/app-element/app-element.js';
import {
  accessByPath, 
  curry
}                 from '@longlost/lambda/lambda.js';
import {
  listen, 
  schedule,
  wait
}                 from '@longlost/utils/utils.js';
import services   from '@longlost/services/services.js';
import htmlString from './items-sync.html';


const sameSubKeys = [
  'coll', 
  'dbPricePaths', 
  'dbQtyPaths', 
  'docProp', 
  'pricePaths', 
  'qtyPaths', 
  'type'
];

const sameSubs = (subA, subB) => {
  if (!subA || !subB) { return false; }
  return sameSubKeys.every(key => {
    const valA = subA[key];
    const valB = subB[key];
    if (key === 'docProp') {
      return subA.item[valA] === subB.item[valB];
    }
    if (Array.isArray(valA)) {
      return valA.every((val, index) => val === valB[index]);
    }
    return valA === valB;
  });
};

const seperateSubs = (incomings = [], currents = []) => {
  return incomings.reduce((accum, sub) => {
    const match = currents.find(currSub => sameSubs(sub, currSub));
    if (match) {
      accum.matchingSubs.push(match);
    }
    else {
      accum.nonMatchingSubs.push(sub);
    }
    return accum;
  }, {matchingSubs: [], nonMatchingSubs: []});
};

const getSyncSymbol = item => {
  const symbols = Object.getOwnPropertySymbols(item);
  return symbols.find(symbol => item[symbol] === 'itemsSyncSymbol');
};
// overwrite each current subsription with its 
// matching incoming subscription item 
const updateSubItems = (currents, subs) => {
  return currents.map(current => {
    const {item}   = subs.find(sub => sameSubs(sub, current));
    const merged   = Object.assign({}, current.item, item);
    return Object.assign({}, current, {item: merged});
  });
};
// add a symbol so we can seperate unique 
// items for slotted template dom-repeat'ers
const addSymbol = sub => {
  const itemWithSymbol = Object.assign(
    {}, 
    sub.item, 
    {[Symbol()]: 'itemsSyncSymbol'}
  );
  return Object.assign(
    {}, 
    sub, 
    {item: itemWithSymbol}
  );
};

const findSub = (subscription, subs) => {
  if (!subs) { return subscription; }        
  return subs.find(sub => sameSubs(subscription, sub));
};

const accessNumByPath = (path, obj) => Number(accessByPath(path, obj));

const compareItemPaths = curry((subscription, dbItem, kind, path, dbPath) => {
  const {item}    = subscription;
  const itemNum   = accessNumByPath(path, item);
  const dbItemNum = accessNumByPath(dbPath, dbItem);
  if (itemNum !== dbItemNum) { 
    const change = Object.assign(
      {},
      subscription,
      {             
        dbItem, 
        dbPath,
        dbVal:        dbItemNum,
        kind, 
        path,
        val:          itemNum,
        // not updated by changes
        // used in updateChangeByPaths as a 
        // reference val for qty when 
        // the in stock qty rises above cart qty
        referenceVal: itemNum
      }
    );
    return change; 
  }
});

const errorCallback = error => console.warn('items sync error: ', error);
// resolved changes are those that have a 
// 'quantity' db value that is equal to or more than 
// the cart qty ('referenceVal')
const filterByResolvedQty = change => {
  const {dbVal, kind, referenceVal, val} = change;
  if (kind === 'price')     { return true; }
  if (dbVal < referenceVal) { return true; }
  if (referenceVal !== val) { return true; }
  return false;
};
// take out all changes that have been resolved
// (in-stock quantities are enough to fulfill this order)
const filterResolvedQtyChanges = changes => changes.filter(filterByResolvedQty);

const makeChangesPayload = changes => {
  const changesByType = changes.reduce((accum, change) => {
    const {type} = change;
    accum[type]  = accum[type] ? [...accum[type], change] : [change];
    return accum;
  }, {});
  return {changes: changesByType};
};

const getUniqueItemsFromChanges = changes => {
  const uniquesObj = changes.reduce((accum, change) => {
    const {item}  = change;
    const symbol  = getSyncSymbol(item);
    accum[symbol] = item;
    return accum;
  }, {});
  const uniquesObjSymbols = Object.getOwnPropertySymbols(uniquesObj);
  const uniques = uniquesObjSymbols.map(symbol => uniquesObj[symbol]);
  return uniques;
};

const lastItem = array => array[array.length - 1];

const filterChangesByKind = (kind, changes) => 
  changes.filter(change => change.kind === kind);
// causes side effects by setting a val on the same obj that it returns
const updateByPath = (obj, path, val) => {
  const keys = path.split('.');
  const last = keys.length - 1;      
  const follow = (nested, key, index) => {
    if (index === last) {
      nested[key] = val;
      return;
    }
    const nextIndex = index + 1;
    return follow(nested[key], keys[nextIndex], nextIndex);
  };
  follow(obj, keys[0], 0);
  return obj;     
};
// update and add 'itemSyncData' obj to item with 'quantityChanged' and 'referenceVal' props
const updateChangeByPaths = (item, change) => {
  if (!change) {
    return item;
  }
  const {
    coll, 
    dbPath, 
    dbVal, 
    docProp, 
    kind, 
    path, 
    referenceVal
  } = change;
  // price follows db price value
  // quantity only increases as high as users original chosen qty
  const val = kind === 'quantity' ? 
                Math.min(dbVal, referenceVal) : dbVal;
  const updatedDbPath = updateByPath(Object.assign({}, item), dbPath, dbVal);
  const updated       = updateByPath(updatedDbPath, path, val);  
  // must add itemSyncData obj to each inventoried item 
  // to display labels on items with qty changes
  if (kind === 'quantity') {
    const itemSyncData = {
      quantityChanged: true,
      referenceVal
    };
    // orderQty used by pay, orders and emails
    return Object.assign(
      {}, 
      updated, 
      {itemSyncData, orderQty: val}
    );  
  }
  else if (kind === 'price') {
    // amount used by pay, orders and emails
    const amount = Number(val).toFixed(2);
    return Object.assign({}, updated, {amount});  
  }
  else {
    throw new Error('Items-sync kind must be a string equal to quantity or price.');
  }  
};    

const syncSameTypeChanges = (items, changes) => {
  return items.map(item => {
    const matchingChanges = changes.filter(change => 
      change.matcher(change.item, item));
    if (!matchingChanges.length) { return item; }
    // most recent change to apply
    const lastPriceChange = 
      lastItem(filterChangesByKind('price', matchingChanges));
    const lastQtyChange =
      lastItem(filterChangesByKind('quantity', matchingChanges));      
    const updatedWithLastPriceChange = 
      updateChangeByPaths(item, lastPriceChange);
    const updatedWithLastQtyChange = 
      updateChangeByPaths(updatedWithLastPriceChange, lastQtyChange);
    return updatedWithLastQtyChange;
  });
};
// Uses a matcher function for each item change that can guarantee 
// uniqueness amongst items and changes being passed in.
// Will update based on the subscrptions dbPaths and paths.
// Items with quantity changes will have a 
// 'quantityChanged' boolean set on them, which will be true
// when db qtys are different than selected/in-cart qtys
const syncChanges = (itemsObj, allChanges) => {
  const keys    = Object.keys(itemsObj);
  const payload = makeChangesPayload(allChanges);
  const synced  = keys.reduce((accum, key) => {
    const changes = payload.changes[key];
    if (!changes) { return accum; }    
    const items = itemsObj[key];
    accum[key]  = syncSameTypeChanges(items, changes);
    return accum;
  }, {});
  return synced;    
};


class CheckoutItemsSync extends AppElement {
  static get is() { return 'checkout-items-sync'; }

  static get template() {
    return html([htmlString]);
  }

  static get properties() {
    return {

      checkoutOpen: Boolean,
      // inventory item configs
      subscriptions: Array,
      // via checkout-pay
      // user is in middle of payment, must ignore late changes
      tooLateToOpen: Boolean,
      // latch for price-availablity-changed.js 'slotchange' handler
      _canSetNewLabels: Boolean,
      // prevent infinite loops, only start new subscriptions
      // on NEW items coming in
      _currentSubs: Array,

      _changes: {
        type: Array,
        value: () => ([])
      },
      // add inventoryAdjust obj to each inventoried item for 'pay' cloud function
      _inventoryAdjustments: {
        type: Array,
        computed: '__computeInventoryAdjustments(subscriptions)'
      },

      _inventoryItemsObj: {
        type: Object,
        computed: '__computeInventoryItemsObj(subscriptions)'
      },

      _unresolvedChanges: {
        type: Array,
        computed: '__computeUnresolvedChanges(_changes)'
      }
      
    };
  }


  static get observers() {
    return [
      '__subscriptionsChanged(subscriptions)',
      '__inventoryAdjustmentsChanged(_inventoryAdjustments)'
    ];
  }


  connectedCallback() {
    super.connectedCallback();

    listen(this, 'proceed-with-changes', this.__proceed.bind(this));
    listen(this, 'edit-order',           this.__editCart.bind(this));
    listen(this, 'cancel-order',         this.__cancelOrder.bind(this));
  }
  // must add inventoryAdjust obj to each inventoried item for 'pay' cloud function
  // 'pay' cloud function --> 'completeOrder' triggered cloud function --> adjustInventory function
  __computeInventoryAdjustments(subs) {
    if (!subs) { return []; }
    // there can be more adjustments than items
    // in case the item schema handles multiple items per obj
    return subs.reduce((accum, sub) => {
      const {
        coll,
        dbQtyPaths,
        docProp,
        item,
        qtyPaths
      } = sub;
      const adjustments = qtyPaths.map((path, index) => ({
        coll,
        doc:  item[docProp],
        // use db path to update db val with selected val
        path: dbQtyPaths[index], 
        // use selected path to retrieve selected val which updates db val         
        val:  accessNumByPath(path, item)
      })); 
      return [...accum, ...adjustments];      
    }, []);
  }


  __computeInventoryItemsObj(subs) {
    return subs.reduce((accum, sub) => {
      const {item, type} = sub;
      accum[type] = accum[type] ? [...accum[type], item] : [item];
      return accum;
    }, {});
  }


  __computeUnresolvedChanges(changes) {
    if (!changes) { return; }
    return filterResolvedQtyChanges(changes);
  }


  __inventoryAdjustmentsChanged(adjustments) {
    if (!adjustments) { return; }
    this.fire('items-sync-adjustments', {adjustments});
  }


  async __setSlottedItems(payload) {
    const {changes: changesObj} = payload;
    const keys = Object.keys(changesObj);
    // used to force slotted template dom-repeaters to update
    const undefinedItems = keys.reduce((accum, key) => {
      accum[key] = undefined;
      return accum;
    }, {});
    const items = keys.reduce((accum, key) => {
      accum[key] = getUniqueItemsFromChanges(changesObj[key]);
      return accum;
    }, {});
    // force update repeaters
    this.fire('items-sync-update-slotted', undefinedItems);
    // must wait so 'slotchange' event fires in price-availability-changed.js
    await schedule();
    this._canSetNewLabels = undefined;
    this._canSetNewLabels = true;
    this.fire('items-sync-update-slotted', items);
  }  


  async __handleChanges(changes) {
    try {
      // dont want to miss any changes
      // so put this before the debounce
      this._changes = [...this._changes, ...changes];
      await this.debounce('items-sync-changes-debounce', 500);        
      if (this.checkoutOpen) {
        if (this.tooLateToOpen) { return; } // payment in progress
        // ignore changes of qty going higher than what is already being purchased
        // dont want to interrupt checkout flow unless a price changes or a qty falls
        // below what they want to buy        
        if (!this._unresolvedChanges || !this._unresolvedChanges.length) { return; }
        const payload = makeChangesPayload(this._unresolvedChanges);
        // must interupt checkout flow
        // show a modal
        this.fire('items-sync-close-pay');
        this.fire('items-sync-close-modals');
        await wait(300);
        await import('./price-availability-changed.js');
        await this.$.changed.openModal(); 
        this.__setSlottedItems(payload);
      }
      else {
        const synced = syncChanges(this._inventoryItemsObj, this._changes);
        this.fire('items-sync-changes', synced);
      }
    }
    catch (error) {
      if (error === 'debounced') { return; } // debounce errors
      console.error(error);
    }   
  }


  __buildSubscription(subscription) {
    const {
      coll,
      dbPricePaths,
      dbQtyPaths,
      docProp,
      item,
      pricePaths, 
      qtyPaths
    } = subscription;

    const callback = dbItem => {
      // check for new items in this._currentSubs
      // they will be updated with a new item anytime 
      // there is a new incoming sub that matches a current one
      const sub = findSub(subscription, this._currentSubs);
      const comparePaths = compareItemPaths(sub, dbItem);
      const priceChanges = pricePaths.map((path, index) => 
        comparePaths('price', path, dbPricePaths[index])); 
      const qtyChanges = qtyPaths.map((path, index) => 
        comparePaths('quantity', path, dbQtyPaths[index])); 
      const changes = [...priceChanges, ...qtyChanges].
        filter(change => change); // filter out undefined
      if (!changes.length) { return; }
      this.__handleChanges(changes);          
    };

    return services.subscribe({
      callback,
      coll, 
      doc: item[docProp], 
      errorCallback
    });
  }

  // set subscriptions for each item in cart
  async __subscriptionsChanged(subscriptions) {
    try {
      if (!subscriptions) { return; }
      await this.debounce('items-sync-subscriptions-debounce', 100);
      this.__clearChanges();
      const subsWithItemSymbols = subscriptions.map(addSymbol);
      // filter out previous subs and new subs
      const {
        matchingSubs:    currentSubs, 
        nonMatchingSubs: newSubs
      } = seperateSubs(subsWithItemSymbols, this._currentSubs);
      // filter obsolete subs
      const {
        nonMatchingSubs: obsoleteSubs
      } = seperateSubs(this._currentSubs, subsWithItemSymbols);
      // done with these so unsubscribe
      obsoleteSubs.forEach(obsoleteSub => {
        obsoleteSub.unsubscribe();
      });      
      // must replace current subs' items with the items from incoming subscriptions
      // in case user has updated those items
      const updatedCurrentSubs  = updateSubItems(currentSubs, subsWithItemSymbols);
      const unsubscribePromises = newSubs.map(this.__buildSubscription.bind(this));
      const unsubscribes        = await Promise.all(unsubscribePromises);
      const newSubsWithUnsubscribe = 
        newSubs.
          map((sub, index) => 
            Object.assign({}, sub, {unsubscribe: unsubscribes[index]}));
      this._currentSubs = [...updatedCurrentSubs, ...newSubsWithUnsubscribe];
    }
    catch (error) {
      if (error === 'debounced') { return; }
      console.error(error);
    }
  }


  __clearChanges() {
    this._changes = [];
  }


  __handlePriceAvailEvents(event) {
    const {changes} = event.detail; // only unresolved changes
    const synced    = syncChanges(this._inventoryItemsObj, changes);
    this.__clearChanges();
    return synced;
  }


  __proceed(event) {
    // if there are qty changes, checkout will move 
    // user back to info view so shipping can be recalculated
    const {changes}  = event.detail;
    const qtyChanges = changes.some(change => change.kind === 'quantity');
    const synced     = this.__handlePriceAvailEvents(event);
    this.fire('items-sync-proceed', {qtyChanges, synced});   
  }


  __editCart(event) { 
    const synced = this.__handlePriceAvailEvents(event);
    this.fire('items-sync-edit-cart', {synced});  
  }


  __cancelOrder(event) {
    const synced = this.__handlePriceAvailEvents(event);
    this.fire('items-sync-cancel-order', {synced});
  }


  reset() {
    this.__clearChanges(); 
  }
  // checkout-pay via app-checkout
  // 'invalid-argument' errors from late changes during payment processing
  // or an attempt to hack prices
  // pay is closed at this point so show changes modal if there are any changes
  async openModal() {
    // ignore changes of qty going higher than what is already being purchased
    // dont want to interrupt checkout flow unless a price changes or a qty falls
    // below what they want to buy        
    if (!this._unresolvedChanges || !this._unresolvedChanges.length) { return; }
    const payload = makeChangesPayload(this._unresolvedChanges); 
    this.fire('items-sync-close-modals');
    await wait(300);   
    await import('./price-availability-changed.js');
    await this.$.changed.openModal(); 
    this.__setSlottedItems(payload);
  }

}

window.customElements.define(CheckoutItemsSync.is, CheckoutItemsSync);
