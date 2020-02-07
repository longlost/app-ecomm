
/**
  * `shipping`
  * 
  *   Create shipping labels for all tangible sold items.
  *
  *
  *
  **/

'use strict';

const createParcels = require('./packing');
const Shippo        = require('shippo');


// Determine whether to use shippo to verify US addresses only.
// International verification charges the client account.
const formatAddress = address => {
  const {country}        = address;
  const formattedCountry = country.
                             trim().
                             split(' ').
                             join('').
                             split('.').
                             join('').
                             toUpperCase();
  if (
    formattedCountry === 'US' || 
    formattedCountry === 'USA' || 
    formattedCountry === 'UNITEDSTATES' || 
    formattedCountry === 'UNITEDSTATESOFAMERICA'
  ) {
    return Object.assign(
      {}, 
      address, 
      {country: formattedCountry, validate: true}
    );
  }

  return Object.assign({}, address, {validate: false});
};


const createShipmentPromises = ({shippo, address: businessAddr}, parcels, address) => 
  parcels.map(parcel => {
    const shipment = {
      'address_from': businessAddr,
      'address_to':   address,
      'async':        false,
      'parcels':      [parcel]
    };
    return shippo.shipment.create(shipment);
  });

// International must include customs declaration.
const createCustomsShipmentPromises = ({shippo, address: businessAddr, signer}, parcels, address) => 
  parcels.map(parcel => {
    const customsItems = parcel.customsItemsData.map(data => {
      const {description, net_weight, value_amount} = data;

      const customsItem = {
        description,
        mass_unit:      'kg',
        net_weight,
        origin_country: 'US',
        quantity:        1,
        value_amount,
        value_currency: 'USD',
      };

      return customsItem;
    });

    const declaration = {
      certify:              true,
      certify_signer:       signer,
      contents_type:       'MERCHANDISE',
      items:                customsItems,
      non_delivery_option: 'RETURN'
    };

    return shippo.customsdeclaration.create(declaration).
      then(customsDeclaration => {
        const shipment = {
          'address_from':        businessAddr,
          'address_to':          address,
          'async':               false,
          'customs_declaration': customsDeclaration,
          'parcels':             [parcel]
        };
        return shippo.shipment.create(shipment);
      });
  });

// GetShippingRates helper.
const formatRates = shipments => {
  if (!Array.isArray(shipments)) { return shipments; } // Not a valid address, return obj.

  // Return an obj -> {address_to, rates}.
  const {address_to} = shipments[0]; // All shipment objs have same address_to.
  const ratesArrays  = shipments.map(shipment => shipment.rates); // 2D array.

  // Count occurances of each service level for each parcel.
  const allLevels    = ratesArrays.reduce((accum, array) => {
    array.forEach(obj => {
      const token = obj.servicelevel.token;

      if (accum[token] !== undefined && accum[token] !== null) {
        accum[token] += 1;
      }
      else {
        accum[token] = 1;
      }
    });

    return accum;
  }, {});

  const keys        = Object.keys(allLevels);
  const parcelCount = ratesArrays.length;

  // Keep only service levels that are available to all parcels.
  const sharedLevels        = keys.filter(key => allLevels[key] === parcelCount);
  const flattenedRatesArray = ratesArrays.reduce((accum, array) => [...accum, ...array], []);

  // Return data formatted for easy consumption in a template dom-repeat.
  const formattedRates = sharedLevels.map(level => {

    const parcelsRates   = flattenedRatesArray.filter(el => el.servicelevel.token === level);
    const rateObjectIds  = parcelsRates.map(rate => rate.object_id);
    const estimates      = parcelsRates.map(rate => Number(rate.estimated_days));
    const estimated_days = Math.max(...estimates); // Take most conservative estimate.

    const totalInt = parcelsRates.reduce((prev, curr) => {
      const tot = prev + (Number(curr.amount) * 100);
      return tot;
    }, 0);

    const total = totalInt / 100;

    const {
      duration_terms,
      provider, 
      provider_image_75, 
      provider_image_200, 
      servicelevel
    } = parcelsRates[0];

    const rateObj = {
      duration_terms,
      estimated_days, 
      name: servicelevel.name,
      parcelsRates,
      provider,
      provider_image_75,
      provider_image_200,
      rateObjectIds,
      total
    };

    return rateObj;
  });

  // Sort lowest price to highest.
  const rates = formattedRates.sort((a, b) => a.total - b.total);

  return {address_to, rates};
};

// For inventory items only, not post-pay items/services.
// Start with the smallest viable box and iterate up sizes until no remainder.
//   return -> [rates]
const getRates = (shippo, business, boxes) => data => {
  const dependencies = {
    shippo, 
    address: business.address, 
    signer:  business.customsCertifySigner
  };

  const {address, items} = data;

  // Bail if the schema is incorrect.
  const missingSchema = items.find(
    ({amount, displayName, description, shipping}) => 
      !amount || !displayName || !description || !shipping || typeof shipping !== 'object'
  );

  if (missingSchema) {
    throw new Error(
      `Each shipped item needs the following props: 

        amount:      USD,
        description: a short description of the item,
        displayName: human readable name,
        shipping: {
          height: cm,
          length: cm,
          weight: kg,
          width:  cm
        }`
    );
  }

  const addressTo = formatAddress(address);

  // Add a symbol packing id key to match up later with packer item counterparts.
  const uniqueItems = items.map(item => 
                        Object.assign({}, item, {packingId: Symbol()}));

  const parcels = createParcels(uniqueItems, boxes); // cloud-bin-packing.js

  const validateUSshipments = validationResult => {
    const {is_complete, validation_results} = validationResult;

    if (is_complete && validation_results.is_valid) {
      const shipmentPromises = 
        createShipmentPromises(dependencies, parcels, validationResult);

      return Promise.all(shipmentPromises);
    }

    return Object.assign({is_complete}, validation_results);
  };

  // Validate all US addresses.
  if (addressTo.validate) {
    return shippo.address.create(addressTo).
      then(validateUSshipments).
      then(formatRates).
      catch(error => 
        new Error('getShippingRates:domestic error ', error));
  }
  else {
    const shipmentPromises = 
      createCustomsShipmentPromises(dependencies, parcels, addressTo);

    return Promise.all(shipmentPromises).
      then(formatRates).
      catch(error => 
        new Error('getShippingRates:foreign error ', error));
  }
};

// Create shipping labels in shippo dashboard.
const makeLabels = shippo => (rateIds, orderId) => {
  if (!rateIds) { return Promise.resolve('no shipments'); } // Nothing to ship ie. services.

  const shippingTransactionPromises = rateIds.map(id => 
    shippo.transaction.create({'rate': id, 'metadata': orderId, 'async': false}));

  return Promise.all(shippingTransactionPromises).
    catch(error => {
      console.error('Shippo label creation error: ', error);
      return Promise.resolve('shippo label creation unsuccessful'); // Fail gracefully.
    });
};


const initShippo = options => { 
  const {business, env} = options;

  const shippoKey = env === 'production' ? 
    options.shippo.production : options.shippo.sandbox;
    
  const shippo = Shippo(shippoKey);

  const getShippingRates   = getRates(shippo, business, options.shippo.boxes);
  const makeShippingLabels = makeLabels(shippo);

  return {
    getShippingRates,
    makeShippingLabels
  };
};

module.exports = initShippo;
