
/**
	*	`checkout`
	*
  *
  * inventory:
  * 
  *   each item must have an inventoryAdjust obj with coll, doc, field props
  * 
  *   ie. item === {
  *         ...
  *         inventoryAdjust: {
  *           coll,
  *           doc,
  *           field, // can use dot notation here to access nested objects ie. 'foil.Near Mint.qty',
  *           val    // number to take out of inventory
  *         }
  *         ...
  *       }
  *   
  * shipping:
  * 
  *   each item must have amount, description, displayName, shipping props
  *
  *   ie. item === {
  *         ...
  *         amount,       (msrp)
  *         description,  (short item description)
  *         displayName,  (human readable string)
  *         shipping: {
  *           height,     (cm)
  *           length,     (cm)
  *           weight,     (kg)
  *           width,      (cm)
  *         }
  *         ...
  *       }
  *
  * pay:
  *
  *   each item must have amount, displayName props
  *
  *   ie. item === {
  *         ...
  *         amount,      (msrp)
  *         displayName, (human readable string)
  *         ...
  *       }
  *
  **/


'use strict';


const sendgrid   = require('@sendgrid/mail');
const braintree  = require('braintree');
const initShippo = require('./cloud-shippo');


const initGateway = (env, opts) => {
  const {Production, Sandbox} = braintree.Environment;
  const environment = env === 'production' ? Production : Sandbox;
  const {merchantId, privateKey, publicKey} = opts[env];

  // Returns a gateway.
  return braintree.connect({
    environment,
    merchantId,
    privateKey,
    publicKey
  });
};

// 'completeOrder' helper.
// Send branded payment receipt to customer.
const receipt = dependencies => async (order, transaction) => {
  try {
    const {
      business, 
      receiptEmail, 
      receiptTemplate
    } = dependencies;

    const {
      address, 
      amount,
      credit,
      date, 
      email, 
      fullName, 
      items, 
      orderId,
      orderType,
      shippingCost, 
      subtotal, 
      tax
    } = order;

    const itemRows = items.map(item => {
      const {amount, displayName, orderQty} = item;
      const price = Number(amount).
        toFixed(2).
        toLocaleString(undefined, {style: 'currency', currency: 'USD'});

      return Object.assign({}, item, {displayName, orderQty, price}); // Email template data bindings.
    });

    // Address present if there are shipping items,
    // otherwise fullName will be used for name and other 
    // shipping props will not be used.
    const getUserData = (addr, name) => addr ? addr : {name};

    const {
      name, 
      street1,
      street2, 
      city, 
      state, 
      zip, 
      country, 
      phone
    } = getUserData(address, fullName);

    const {
      amount: transactionAmount,
      creditCard,
      processorAuthorizationCode,
      processorResponseText
    } = transaction;

    // There's no transaction and thus no creditCard for pickup orders.
    const {cardType, cardholderName, last4} = creditCard ? creditCard : {};

    const total = transactionAmount ? transactionAmount : amount;

    const formattedStreet2 = street2 ? ` ${street2}` : '';

    const msg = {
      to:          email,
      bcc:         receiptEmail,
      from:        business.address.email,
      subject:    `${business.address.name} Receipt`,
      templateId:  receiptTemplate,
      dynamicTemplateData: {
        date,
        status:           processorResponseText,
        confirmationCode: processorAuthorizationCode,
        cardholderName,
        cardType,
        credit,
        itemRows,
        last4,
        name,
        email,
        orderId,
        orderType,
        street1,
        street2:          formattedStreet2,
        city, 
        state, 
        zip, 
        country, 
        phone,
        shippingCost,
        subtotal,
        tax,
        total
      }
    };

    // Awaiting here so we can catch all errors here and fail gracefully
    // since payment is already recieved, and we dont want the other functions
    // that run to complete the order to fail because of an issue here.
    await sendgrid.send(msg);
  }
  catch (error) {

    // Catch all local errors to fail gracefully.
    // const {message, code, response} = error;
    // const {headers, body}           = response;
    // console.error('sendgrid error: ', message, body.errors);
    console.error('sendReceiptEmail failed gracefully: ', error);
  }
};

// 'adjustInventory' helper.
// Use a path string (ie. 'shipping.dimensions.height')
// to read a val in a nested object.
const accessByPath = (path, obj) => {
  const keys = path.split('.');

  return keys.reduce((accum, key) => accum[key], obj);
};

// Pull in admin and functions deps from functions/index.js.
exports.init = (admin, functions) => {

  // 'completeOrder' helper.
  // Take sold items out of inventory.
  // Only inventoryItems with an inventoryAdjust 
  // obj ({coll, doc, path, val}) will be updated.
  const adjustInventory = async order => {
    try {
      const {inventoryAdjustments, orderType} = order;

      // Services, store events, etc don't have inventory adjustments.
      if (!inventoryAdjustments) { 
        return; 
      }

      const adjustmentsWithRefs = inventoryAdjustments.map(adjustment => {
        const {coll, doc} = adjustment;
        const ref = admin.firestore().collection(coll).doc(doc);

        return Object.assign({}, adjustment, {ref});
      });

      // Awaiting here so we can catch errors and fail gracefully 
      // so we don't stop other post order functions from finishing.
      await admin.firestore().runTransaction(async transaction => {
        const getPromises = 
          adjustmentsWithRefs.map(({ref}) => 
            transaction.get(ref));

        const docs = await Promise.all(getPromises);

        const adjustmentsWithDocs = 
          adjustmentsWithRefs.map((adjustment, index) => 
            Object.assign({}, adjustment, {document: docs[index]}));

        adjustmentsWithDocs.forEach(({
          coll, 
          doc, 
          document, 
          path, 
          ref, 
          val
        }) => {

          if (!document.exists) { 
            console.error(`${coll}/${doc} does not exist!`);
            return;
          } 

          const dbData = document.data(); 

          // Cannot use field to access firestore nested directly in case 
          // the field string has string values with spaces, so must walk
          // the object in js with accessByPath.
          const current = accessByPath(path, dbData);
          const newQty  = Number(current) - Number(val);

          transaction.update(ref, {[path]: newQty});
        });
      });   
    }
    catch (error) {

      // Catch all errors locally to fail gracefully so 
      // other post order functions are not stopped.
      console.error('adjustInventory failed gracefully: ', error);
    }  
  };

  // 'completeOrder' helper.
  // Create shipping labels in shippo dashboard after payment
  // transaction is successful.
  // Save the order to the user's data.
  const makeLabelsSaveOrder = async (makeLabels, order) => {
    try {
      const {orderId, rateIds, uid} = order;

      const shippoTransactions = await makeLabels(rateIds, orderId);

      if (!uid) { return 'anonymous user'; } // Anonymous user.

      order.shippoTransactions = shippoTransactions; // Shipping label data.

      // Awaiting here so as to catch all errors locally and fail gracefully.
      // We dont want to halt other post order functions because of a failure here.
      await admin.
              firestore().
              collection('users').
              doc(uid).
              collection('orders').
              doc(order.orderId).
              set(order);

      return null;
    }
    catch (error) {

      // Consume all errors here to fail gracefully.
      console.error('makeLabelsSaveOrder failed gracefully: ', error);
    }  
  };

  // Triggers 'completeOrder' Firestore cloud trigger function.
  const saveOrder = async order => {
    try {

      // Read then increment orderId.
      let id; // Cannot return a val from runTransaction function.

      const ref = admin.firestore().collection('ids').doc('orderId');

      await admin.firestore().runTransaction(async transaction => {

        const doc = await transaction.get(ref); 

        if (!doc.exists) { 
          console.error('ids/orderId document does not exist!');
          return;
        } 

        const orderId = doc.data().orderId + 1; // Cannot return a val from runTransaction function.
        id = orderId.toString();

        transaction.update(ref, {orderId});
      });
      const timestamp = Date.now(); // Date is added on client to capture user timezone aware times.

      // 'orderFulfilled' used by cms order dashboard.
      const orderData = Object.assign(
        {}, 
        order, 
        {orderId: id, timestamp}
      );

      // Awaiting here to fail gracefully.
      await admin.firestore().collection('orders').doc(id).set(orderData);

      return null;
    }
    catch (error) {  

      // MUST fail gracefully since we already have their money, no going back.
      console.error(
        `
        Fatal save pay order error!!

        user id: ${order.uid}

        This means a receipt was NOT sent to user, 
        inventory adjustments were NOT made, 
        NO shipping labels where created, and 
        the order was NOT saved to user data! 
        
        error:`,       
        error,
        ' order: ',
        order    
      );
    }
  };

  // Send a pick ticket to designated email address for pick tickets.
  // Temp workaround for easy printing.
  const pickTicket = dependencies => async order => {
    try {  
      const {
        business, 
        pickTicketEmail, 
        pickTicketTemplate
      } = dependencies;

      const {
        address, 
        date, 
        email, 
        fullName, 
        items, 
        orderId,
        orderType
      } = order;

      // Address present if there are shipping items.
      // Otherwise, 'fullName' will be used for name and other 
      // shipping props will not be used.
      const getUserData = (addr, name) => addr ? addr : {name};

      const {
        name, 
        street1,
        street2, 
        city, 
        state, 
        zip, 
        country, 
        phone
      } = getUserData(address, fullName);

      const msg = {
        to:         pickTicketEmail,      
        from:       business.address.email,
        subject:   `Pick Ticket Order ${orderId}`,
        templateId: pickTicketTemplate,
        dynamicTemplateData: {
          date,  
          email,      
          itemRows: items,
          orderId,
          orderType,
          name, 
          street1,
          street2, 
          city, 
          state, 
          zip, 
          country, 
          phone
        }
      };
      
      await sendgrid.send(msg); // Must await to catch the error here.

      return null;
    }
    catch (error) {
      console.error(error);
      throw new functions.https.HttpsError('unknown', 'generatePickTicket error', error);
    }
  };


  const makeInt = numOrStr => 
    numOrStr === undefined ? 0 : Number(numOrStr) * 100;

  const makeCurrency = num => (num / 100).toFixed(2);  

  const adjustCredit = async data => {
    const {credit, shippingCost, subtotal, tax, uid} = data;
    const creditInt = makeInt(credit);

    // Check uid for use in post-pay pickup orders.
    if (creditInt > 0 && uid && uid !== 'anonymous') {
      const totInt = makeInt(subtotal) + makeInt(tax) + makeInt(shippingCost);
      const adjustedCredit = makeCurrency(Math.max(creditInt - totInt, 0));

      await admin.
        firestore().
        collection(`users/${uid}/credit`).
        doc('asg').
        set({
          credit: adjustedCredit
        });

      return adjustedCredit;
    }

    return '0.00';
  };


  const checkout = options => {
    const {
      business, 
      env
    } = options;

    const {
      apiKey,
      pickTicketEmail, 
      pickTicketTemplate, 
      receiptEmail, 
      receiptTemplate
    } = options.sendgrid;

    const {
      getShippingRates, 
      makeShippingLabels
    } = initShippo(options);

    const gateway = initGateway(env, options.braintree);

    const sendGridDependencies = {
      business, 
      pickTicketEmail,
      pickTicketTemplate,
      receiptEmail,
      receiptTemplate
    }; 

    const generatePickTicket = pickTicket(sendGridDependencies);  
    const sendReceiptEmail   = receipt(sendGridDependencies);

    sendgrid.setApiKey(apiKey);

    // Add functions error handling.
    const shippingRates = async (...args) => {
      try {
        const rates = await getShippingRates(...args);

        return rates;
      }
      catch (error) {
        console.error(error);
        throw new functions.https.HttpsError('unknown', error);
      }
    };

    // Braintree payment integration.
    const payUserToken = async ({braintreeCustomerId}) => {
      try {
        const {clientToken} = 
          await gateway.clientToken.generate({customerId: braintreeCustomerId});

        return clientToken;
      }
      catch (error) {
        console.error(error);
        throw new functions.https.HttpsError('unknown', error);
      }
    };

    // Braintree payment integration.
    // Triggers 'completeOrder' cloud function in the background.
    const pay = async data => {

      // data === {amount, email, items, nonce, rateIds, subtotal, total, tax, uid}.
      const {amount, credit, items, nonce, uid} = data;

      // Bail if the schema is incorrect.
      const missingSchema = items.find(({amount, displayName}) => !amount || !displayName);

      if (missingSchema) {
        throw new functions.https.HttpsError(
          'invalid-argument', 
          `
            Pay schema error
            Each sold item needs the following props: 

              amount:      USD,
              displayName: human readable name
          `
        );
      }

      const amountInt = makeInt(amount);

      // Credit covers full sale amount, bypass Braintree.
      if (amountInt === 0) { // Store credit.

        const adjustedCredit = await adjustCredit(data);

        const order = Object.assign(
          {}, 
          data, 
          {adjustedCredit, paidInFullWithCredit: true}
        );

        // Trigger 'completeOrder' function to run in the background.
        await saveOrder(order);

        return null;
      }
      else {

        // Charge payment method.
        const braintreeResult = await gateway.transaction.sale({
          amount,
          paymentMethodNonce: nonce,
          options: {
            submitForSettlement: true
          }
        });

        const {success, transaction} = braintreeResult;

        if (!success) { // Declined.
          console.error('Braintree unsuccessful: ', braintreeResult);
          return braintreeResult;   
        }

        // MUST run adjustCredit ONLY AFTER a successful braintree transaction.
        const adjustedCredit = await adjustCredit(data); 

        // Firebase does not like the transaction object as is (new operator).
        const json = JSON.stringify(transaction);

        const order = Object.assign(
          {}, 
          data, 
          {
            adjustedCredit, 
            braintreeTransaction: json, 
            nonce: '', 
            paidInFullWithCredit: false
          }
        );

        // Trigger 'completeOrder' function to run in the background.
        await saveOrder(order);

        return braintreeResult;
      }
    };

    // Triggerd by 'pay' callable function.
    // Runs in the background so 'pay' can return fast.
    // Run 3 tasks in parallel.
    // Take sold items out of inventory.
    // Create shipping labels for shippable products.
    // Send transactional receipt email to user.
    // Save order and transaction data to firestore.
    const completeOrder = functions.firestore.
      document('orders/{orderId}').
      onCreate(async snapShot => {
        try {
          const order = snapShot.data();
          const {braintreeTransaction: json} = order;

          // No transaction for pickup orders.
          const transaction = json ? JSON.parse(json) : {};

          // Run these tasks in the background so 'pay' function can return fast.
          // Can be run in parallel since they dont depend on one another.
          await Promise.all([
            adjustInventory(order), 
            makeLabelsSaveOrder(makeShippingLabels, order), 
            sendReceiptEmail(order, transaction)
          ]);

          return null;
        }
        catch (error) {
          console.error('completeOrder error: ', error);
        }      
      });

    return {
      adjustCredit, // 'fulfillPickup' in index.js.
      adjustInventory, // 'fulfillPickup' in index.js.
      completeOrder, 
      gateway, // 'seedFirestoreUser' triggered cloud function in index.js.
      shippingRates,
      pay,
      payUserToken,
      generatePickTicket,
      saveOrder, // 'savePickupOrder' in index.js.
      sendgrid
    };
  };

  return checkout;
};
