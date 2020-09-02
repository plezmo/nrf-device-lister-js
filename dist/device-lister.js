'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var Debug = _interopDefault(require('debug'));
var Usb = _interopDefault(require('usb'));
var awaitSemaphore = require('await-semaphore');
var SerialPort = _interopDefault(require('serialport'));
var nrfjprogjs = _interopDefault(require('pc-nrfjprog-js'));
var EventEmitter = _interopDefault(require('events'));

var ErrorCodes = Object.freeze({
    CANNOT_INSTANTIATE_ABSTRACTBACKEND: 0,
    REENUMERATE_NOT_IMPLEMENTED: 1,
    RECEIVED_NEITHER_SNO_NOR_ERROR: 2,
    COULD_NOT_FETCH_SNO_FOR_PORT: 3,
    NO_SERIAL_FROM_PC_NRFJPROGJS: 10,
    LIBUSB_SUCCESS: 100,
    LIBUSB_ERROR_IO: 101,
    LIBUSB_ERROR_INVALID_PARAM: 102,
    LIBUSB_ERROR_ACCESS: 103,
    LIBUSB_ERROR_NO_DEVICE: 104,
    LIBUSB_ERROR_NOT_FOUND: 105,
    LIBUSB_ERROR_BUSY: 106,
    LIBUSB_ERROR_TIMEOUT: 107,
    LIBUSB_ERROR_OVERFLOW: 108,
    LIBUSB_ERROR_PIPE: 109,
    LIBUSB_ERROR_INTERRUPTED: 110,
    LIBUSB_ERROR_NO_MEM: 111,
    LIBUSB_ERROR_NOT_SUPPORTED: 112,
    LIBUSB_ERROR_OTHER: 113,
});

/* Copyright (c) 2010 - 2018, Nordic Semiconductor ASA
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of Nordic Semiconductor ASA nor the names of its
 *    contributors may be used to endorse or promote products derived from this
 *    software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY, AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

var AbstractBackend = function AbstractBackend() {
    if (this.constructor === AbstractBackend) {
        var err = new Error('Cannot instantiate AbstractBackend.');
        err.errorCode = ErrorCodes.CANNOT_INSTANTIATE_ABSTRACTBACKEND;
        throw err;
    }
};

/*
 * Implementations can optionally run some code whenever the device lister
 * starts and stops listening for changes.
 */
/* eslint-disable-next-line class-methods-use-this */
AbstractBackend.prototype.start = function start () {};

/* eslint-disable-next-line class-methods-use-this */
AbstractBackend.prototype.stop = function stop () {};

/* Implementations must returns a `Promise` to an array of objects, like:
 *
 * [{
 *   traits: ['foo', 'bar']
 *   serialNumber: '1234',
 *   backendData: {
 *  serialNumber: '1234',
 *  manufacturer: 'Arduino LLC (www.arduino.cc)',
 *  devNode: '/dev/foobar'
 *   }
 * },{
 *   error: new Error(...),
 *   errorSource: "Unique-ID-for-the-error-source"
 * }]
 *
 * These objects can either be devices with traits known by a specific
 * backend, or errors that the backend wants to raise up.
 *
 * Devices with traits *must* have the `traits` and `serialNumber` properties,
 * plus an optional property containing backend-specific data.
 *
 * Errors are synchronously raised upwards to the conflater, and must include
 * a unique identifier for the source/reason of the error.
 */
AbstractBackend.prototype.reenumerate = function reenumerate () {
    var err = new Error(("Reenumerate must be implemented in " + (this.constructor.name)));
    err.errorCode = ErrorCodes.REENUMERATE_NOT_IMPLEMENTED;
    throw err;
};

/* Copyright (c) 2010 - 2018, Nordic Semiconductor ASA
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of Nordic Semiconductor ASA nor the names of its
 *    contributors may be used to endorse or promote products derived from this
 *    software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY, AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

var debug = Debug('device-lister:usb');

/**
 * Perform a control transfer to get a string descriptor from an already
 * open usb device.
 *
 * @param {Object} device The usb device to get the descriptor for.
 * @param {number} index The index to get.
 * @returns {Promise} Promise that resolves with string descriptor.
 */
function getStringDescriptor(device, index) {
    return new Promise(function (res, rej) {
        device.getStringDescriptor(index, function (err, data) {
            if (err) {
                rej(err);
            } else {
                res(data);
            }
        });
    });
}

/**
 * Perform control transfers to get multiple string descriptors from an
 * already open usb device. Reading the descriptors in sequence, as
 * parallelizing this will produce random libusb errors.
 *
 * @param {Object} device The usb device to get the descriptors for.
 * @param {Array<number>} indexes The indexes to get.
 * @returns {Promise} Promise that resolves with array of string descriptors.
 */
function getStringDescriptors(device, indexes) {
    return indexes.reduce(function (prev, index) { return (
        prev.then(function (descriptorValues) { return (
            getStringDescriptor(device, index)
                .then(function (descriptorValue) { return descriptorValues.concat( [descriptorValue]); })
        ); })
    ); }, Promise.resolve([]));
}

/**
 * Open a usb device.
 *
 * @param {Object} device The usb device to open.
 * @returns {Promise} Promise that resolves if successful, rejects if failed.
 */
function openDevice(device) {
    return new Promise(function (res, rej) {
        var tryOpen = function (retries) {
            if ( retries === void 0 ) retries = 0;

            try {
                device.open();
                res();
            } catch (error) {
                if (process.platform === 'win32' &&
                    retries < 5 &&
                    error.message === 'LIBUSB_ERROR_ACCESS') {
                    // In win platforms, the winUSB driver might allow only one
                    // process to access the USB device, potentially creating
                    // race conditions. Mitigate this with an auto-retry mechanism.
                    debug(("Got LIBUSB_ERROR_ACCESS on win32, retrying (attempt " + retries + ")..."));
                    var delay = (50 * retries * retries) + (100 * Math.random());
                    setTimeout(function () { return tryOpen(retries + 1); }, delay);
                } else {
                    rej(error);
                }
            }
        };
        tryOpen();
    });
}

/**
 * Prefix a given number with 0x and pad with 4 zeroes.
 *
 * @param {Number} number The number to prefix and pad.
 * @returns {string} Prefixed and padded number.
 */
function hexpad4(number) {
    return ("0x" + (number.toString(16).padStart(4, '0')));
}

/**
 * Get a string identifier for the given device. The identifier is on the
 * form "busNumber.deviceAddress vendorId/producId".
 *
 * @param {Object} device The device to get an ID for.
 * @returns {string} String ID for the given device.
 */
function getDeviceId(device) {
    var busNumber = device.busNumber;
    var deviceAddress = device.deviceAddress;
    var ref = device.deviceDescriptor;
    var idVendor = ref.idVendor;
    var idProduct = ref.idProduct;
    return (busNumber + "." + deviceAddress + " " + (hexpad4(idVendor)) + "/" + (hexpad4(idProduct)));
}

/* Copyright (c) 2010 - 2018, Nordic Semiconductor ASA
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of Nordic Semiconductor ASA nor the names of its
 *    contributors may be used to endorse or promote products derived from this
 *    software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY, AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

var debug$1 = Debug('device-lister:usb');

// Module-wide mutex. Not the most efficient (prevents querying several USB devices
// at once) but should do the trick. TODO: Replace this with a Map of mutexes
// keyed by USB bus / USB address.
var mutex = new awaitSemaphore.Mutex();

/**
 * Given a device, runs it through the given filters, and returns an array of
 * the matching filter names.
 *
 * @param {Object} device The usb device to apply filters on.
 * @param {Object} filters Object with filter functions, keyed by filter name.
 * @returns {Array<String>} The filter names that returned a match on the device.
 */
function getMatchingDeviceFilters(device, filters) {
    var filterNames = Object.keys(filters);
    return filterNames.map(function (filterName) {
        if (filters[filterName](device)) {
            return filterName;
        }
        return undefined;
    }).filter(function (filterName) { return filterName; });
}


/**
 * Given a libusb error, this function assigns the error argument an error code
 * representing the error type.
 *
 * @param {Object} err The error to assign an error code to.
 * @returns {Object} The error with a code assigned, given it is a libusb error.
*/
function decorateError(err) {
    var error = err;
    switch (error.message) {
        case 'LIBUSB_SUCCESS': {
            error.errorCode = ErrorCodes.LIBUSB_SUCCESS;
            break;
        }
        case 'LIBUSB_ERROR_IO': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_IO;
            break;
        }
        case 'LIBUSB_ERROR_INVALID_PARAM': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_INVALID_PARAM;
            break;
        }
        case 'LIBUSB_ERROR_ACCESS': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_ACCESS;
            break;
        }
        case 'LIBUSB_ERROR_NO_DEVICE': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_NO_DEVICE;
            break;
        }
        case 'LIBUSB_ERROR_NOT_FOUND': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_NOT_FOUND;
            break;
        }
        case 'LIBUSB_ERROR_BUSY': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_BUSY;
            break;
        }
        case 'LIBUSB_ERROR_TIMEOUT': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_TIMEOUT;
            break;
        }
        case 'LIBUSB_ERROR_OVERFLOW': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_OVERFLOW;
            break;
        }
        case 'LIBUSB_ERROR_PIPE': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_PIPE;
            break;
        }
        case 'LIBUSB_ERROR_INTERRUPTED': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_INTERRUPTED;
            break;
        }
        case 'LIBUSB_ERROR_NO_MEM': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_NO_MEM;
            break;
        }
        case 'LIBUSB_ERROR_NOT_SUPPORTED': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_NOT_SUPPORTED;
            break;
        }
        case 'LIBUSB_ERROR_OTHER': {
            error.errorCode = ErrorCodes.LIBUSB_ERROR_OTHER;
            break;
        }
        default: {
            break;
        }
    }
    return error;
}

/**
 * Backend that enumerates usb devices.
 */
var UsbBackend = (function (AbstractBackend$$1) {
    function UsbBackend(closedDeviceFilters, openDeviceFilters) {
        if ( closedDeviceFilters === void 0 ) closedDeviceFilters = {};
        if ( openDeviceFilters === void 0 ) openDeviceFilters = {};

        AbstractBackend$$1.call(this);
        this._closedDeviceFilters = closedDeviceFilters;
        this._openDeviceFilters = openDeviceFilters;
        this._cachedResults = new Map();
        this._boundRemoveCachedResult = this._removeCachedResult.bind(this);
    }

    if ( AbstractBackend$$1 ) UsbBackend.__proto__ = AbstractBackend$$1;
    UsbBackend.prototype = Object.create( AbstractBackend$$1 && AbstractBackend$$1.prototype );
    UsbBackend.prototype.constructor = UsbBackend;

    UsbBackend.prototype._removeCachedResult = function _removeCachedResult (device) {
        var deviceId = getDeviceId(device);
        debug$1('Removing from cache:', deviceId);
        this._cachedResults.delete(deviceId);
    };

    /* Given an instance of a USB `Device`, returns a `Promise` to *one*
     * structure like:
     *
     * {
     *   traits: ['usb']
     *   serialNumber: '1234',
     *   usb: {
     *      serialNumber: '1234',
     *      manufacturer: 'Arduino LLC (www.arduino.cc)',
     *      product: 'Development board model something'
     *      device: (instance of usb's Device)
     *   }
     * }
     *
     * If the USB `Device` does not match any of the filters given to the
     * class constructor, this will return a `Promise` to a falsy value instead.
     */
    UsbBackend.prototype._getResult = function _getResult (device) {
        var this$1 = this;

        var deviceId = getDeviceId(device);
        if (this._cachedResults.has(deviceId)) {
            debug$1('Reading from cache:', deviceId);
            return this._cachedResults.get(deviceId);
        }

        var result = {
            serialNumber: undefined,
            usb: {
                serialNumber: undefined,
                manufacturer: undefined,
                product: undefined,
                device: device,
            },
            traits: [],
        };

        result.traits = getMatchingDeviceFilters(device, this._closedDeviceFilters);
        if (result.traits.length === 0) {
            debug$1('No matching filters for device:', deviceId);
            return Promise.resolve();
        }

        return mutex.use(function () {
            debug$1('Mutex grabbed.');
            return openDevice(device)
                .then(function () {
                    debug$1(("Opened: " + deviceId));
                    return getStringDescriptors(device, [
                        device.deviceDescriptor.iSerialNumber,
                        device.deviceDescriptor.iManufacturer,
                        device.deviceDescriptor.iProduct ]).then(function (ref) {
                        var serialNumber = ref[0];
                        var manufacturer = ref[1];
                        var product = ref[2];

                        debug$1('Enumerated:', deviceId, [serialNumber, manufacturer, product]);
                        result.serialNumber = serialNumber;
                        result.usb.serialNumber = serialNumber;
                        result.usb.manufacturer = manufacturer;
                        result.usb.product = product;

                        var traits = getMatchingDeviceFilters(device, this$1._openDeviceFilters);
                        result.traits = result.traits.concat(traits);
                    });
                }).catch(function (error) {
                    debug$1('Error when reading device:', deviceId, error.message);
                    var err = decorateError(error);
                    err.usb = device;
                    result = {
                        error: err,
                        errorSource: deviceId,
                    };
                }).then(function () {
                    // Clean up
                    try {
                        device.close();
                    } catch (error) {
                        debug$1('Error when closing device:', deviceId, error.message);
                        if (!result.error) {
                            var err = decorateError(error);
                            err.usb = device;
                            result = {
                                error: err,
                                errorSource: deviceId,
                            };
                        }
                    }
                    debug$1('Releasing mutex.');
                    if (result.traits && result.traits.length === 0) {
                        debug$1('No matching filters for device:', deviceId);
                        return null;
                    }
                    debug$1('Adding to cache:', deviceId);
                    this$1._cachedResults.set(deviceId, result);
                    return result;
                });
        });
    };

    /* Returns a `Promise` to an array of objects, like:
     *
     * [{
     *   traits: ['usb', 'nordicUsb']
     *   serialNumber: '1234',
     *   usb: {
     *      serialNumber: '1234',
     *      manufacturer: 'Arduino LLC (www.arduino.cc)',
     *      product: 'Development board model something'
     *      device: (instance of usb's Device)
     *   }
     * }]
     *
     * See https://doclets.io/node-serialport/node-serialport/master#dl-SerialPort-list
     *
     * If there were any errors while enumerating usb devices, the array will
     * contain them, as per the AbstractBackend format.
     */
    UsbBackend.prototype.reenumerate = function reenumerate () {
        var this$1 = this;

        debug$1('Reenumerating...');
        return Promise.all(Usb.getDeviceList().map(function (device) { return this$1._getResult(device); }))
            .then(function (results) { return results.filter(function (result) { return result; }); });
    };

    UsbBackend.prototype.start = function start () {
        Usb.on('detach', this._boundRemoveCachedResult);
    };

    UsbBackend.prototype.stop = function stop () {
        Usb.removeListener('detach', this._boundRemoveCachedResult);
    };

    return UsbBackend;
}(AbstractBackend));

var BoardVersion = {
    680: 'PCA10031',
    681: 'PCA10028',
    682: 'PCA10040',
    683: 'PCA10056',
    684: 'PCA10068',
    686: 'PCA10064',
    960: 'PCA10090',
};

var getBoardVersion = function (serialNumber) {
    var sn = parseInt(serialNumber, 10).toString();
    var digits = sn.substring(0, 3);
    return BoardVersion[digits];
};

/* Copyright (c) 2010 - 2018, Nordic Semiconductor ASA
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of Nordic Semiconductor ASA nor the names of its
 *    contributors may be used to endorse or promote products derived from this
 *    software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY, AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

var debug$2 = Debug('device-lister:serialport');


function getSerialPorts() {
    return new Promise(function (resolve, reject) {
        SerialPort.list(function (err, ports) {
            if (err) {
                reject(err);
            } else {
                resolve(ports);
            }
        });
    });
}

var SerialPortBackend = (function (AbstractBackend$$1) {
    function SerialPortBackend () {
        AbstractBackend$$1.apply(this, arguments);
    }

    if ( AbstractBackend$$1 ) SerialPortBackend.__proto__ = AbstractBackend$$1;
    SerialPortBackend.prototype = Object.create( AbstractBackend$$1 && AbstractBackend$$1.prototype );
    SerialPortBackend.prototype.constructor = SerialPortBackend;

    SerialPortBackend.prototype.reenumerate = function reenumerate () {
        debug$2('Reenumerating...');
        return getSerialPorts()
            .then(function (ports) { return (
                ports.map(function (port) {
                    debug$2('Enumerated:', port.comName, port.serialNumber);
                    if (port.serialNumber !== undefined) {
                        return {
                            serialNumber: port.serialNumber,
                            serialport: port,
                            boardVersion: getBoardVersion(port.serialNumber),
                            traits: ['serialport'],
                        };
                    }
                    var err = new Error(("Could not fetch serial number for serial port at " + (port.comName)));
                    err.serialport = port;
                    err.errorCode = ErrorCodes.COULD_NOT_FETCH_SNO_FOR_PORT;
                    return {
                        error: err,
                        errorSource: ("serialport-" + (port.comName)),
                    };
                })
            ); }).catch(function (error) {
                debug$2('Error:', error);
                return [{
                    error: error,
                    errorSource: 'serialport',
                }];
            });
    };

    return SerialPortBackend;
}(AbstractBackend));

/* Copyright (c) 2010 - 2018, Nordic Semiconductor ASA
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of Nordic Semiconductor ASA nor the names of its
 *    contributors may be used to endorse or promote products derived from this
 *    software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY, AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

var debug$3 = Debug('device-lister:jlink');

var JlinkBackend = (function (AbstractBackend$$1) {
    function JlinkBackend () {
        AbstractBackend$$1.apply(this, arguments);
    }

    if ( AbstractBackend$$1 ) JlinkBackend.__proto__ = AbstractBackend$$1;
    JlinkBackend.prototype = Object.create( AbstractBackend$$1 && AbstractBackend$$1.prototype );
    JlinkBackend.prototype.constructor = JlinkBackend;

    JlinkBackend.prototype.reenumerate = function reenumerate () {
        debug$3('Reenumerating...');
        return new Promise(function (res, rej) {
            nrfjprogjs.getSerialNumbers(function (err, serialnumbers) {
                if (err) {
                    var error = err;
                    error.errorCode = ErrorCodes.NO_SERIAL_FROM_PC_NRFJPROGJS;
                    rej(error);
                } else {
                    res(serialnumbers);
                }
            });
        }).then(function (serialnumbers) { return serialnumbers.map(function (serialnumber) {
            debug$3('Enumerated:', serialnumber);
            return {
                // The nrfjprogjs provides the serial numbers as integers, what we want
                // is the serial number as described in the USB descriptor (iSerialNumber).
                // The USB descriptor iSerialNumber attribute is of type string.
                //
                // Pad the serial number with '0' with the assumed serial number length of 12
                serialNumber: serialnumber.toString().padStart(12, '0'),
                boardVersion: getBoardVersion(serialnumber),
                traits: ['jlink'],
            };
        }); }).catch(function (err) {
            debug$3('Error:', err.errmsg);
            return [{
                error: err,
                errorSource: 'jlink',
            }];
        });
    };

    return JlinkBackend;
}(AbstractBackend));

/* Copyright (c) 2010 - 2018, Nordic Semiconductor ASA
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of Nordic Semiconductor ASA nor the names of its
 *    contributors may be used to endorse or promote products derived from this
 *    software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY, AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

var debug$4 = Debug('device-lister:conflater');

var SEGGER_VENDOR_ID = 0x1366;
var NORDIC_VENDOR_ID = 0x1915;

var DeviceLister = (function (EventEmitter$$1) {
    function DeviceLister(traits) {
        if ( traits === void 0 ) traits = {};

        EventEmitter$$1.call(this);

        debug$4('Instantiating DeviceLister with traits:', traits);

        // Caches
        this._currentDevices = new Map();
        this._currentErrors = new Set();

        // State for throttling down reenumerations
        this._activeReenumeration = false; // Promise or false
        this._queuedReenumeration = false; // Boolean


        this._backends = [];

        var usb = traits.usb;
        var nordicUsb = traits.nordicUsb;
        var nordicDfu = traits.nordicDfu;
        var seggerUsb = traits.seggerUsb;
        var jlink = traits.jlink;
        var serialport = traits.serialport;

        var usbDeviceClosedFilters = {};
        var usbDeviceOpenFilters = {};
        if (usb) { usbDeviceClosedFilters.usb = function () { return true; }; }
        if (nordicUsb) {
            usbDeviceClosedFilters.nordicUsb = function (device) { return (
                device.deviceDescriptor.idVendor === NORDIC_VENDOR_ID
            ); };
        }
        if (seggerUsb) {
            usbDeviceClosedFilters.seggerUsb = function (device) { return (
                device.deviceDescriptor.idVendor === SEGGER_VENDOR_ID
            ); };
        }
        if (nordicDfu) {
            usbDeviceOpenFilters.nordicDfu = function (device) { return device.deviceDescriptor.idVendor === NORDIC_VENDOR_ID &&
                device.interfaces.some(function (iface) { return (
                    iface.descriptor.bInterfaceClass === 255 &&
                    iface.descriptor.bInterfaceSubClass === 1 &&
                    iface.descriptor.bInterfaceProtocol === 1
                ); }); };
        }

        if (Object.keys(usbDeviceClosedFilters).length > 0 ||
            Object.keys(usbDeviceOpenFilters).length > 0) {
            this._backends.push(new UsbBackend(usbDeviceClosedFilters, usbDeviceOpenFilters));
        }
        if (serialport) { this._backends.push(new SerialPortBackend()); }
        if (jlink) { this._backends.push(new JlinkBackend()); }

        this._boundReenumerate = this._triggerReenumeration.bind(this);
    }

    if ( EventEmitter$$1 ) DeviceLister.__proto__ = EventEmitter$$1;
    DeviceLister.prototype = Object.create( EventEmitter$$1 && EventEmitter$$1.prototype );
    DeviceLister.prototype.constructor = DeviceLister;

    var staticAccessors = { devices: { configurable: true } };

    DeviceLister.prototype.start = function start () {
        debug$4('Attaching event listeners for USB attach/detach');

        Usb.on('attach', this._boundReenumerate);
        Usb.on('detach', this._boundReenumerate);

        this._backends.forEach(function (backend) { return backend.start(); });

        this.reenumerate();
    };

    // Stop listening to attach/detach events from USB
    // Needed to let programs exit gracefully
    DeviceLister.prototype.stop = function stop () {
        debug$4('Removing event listeners for USB attach/detach');

        this._backends.forEach(function (backend) { return backend.stop(); });

        Usb.removeListener('attach', this._boundReenumerate);
        Usb.removeListener('detach', this._boundReenumerate);
    };

    staticAccessors.devices.get = function () {
        return Object.this._currentDevices;
    };

    DeviceLister.prototype.reenumerate = function reenumerate () {
        var this$1 = this;

        // Ask all backends to reenumerate the devices they can see,
        // then (and only then) conflate everything

        debug$4('Asking all backends to reenumerate');

        var pendings = this._backends.map(function (backend) { return backend.reenumerate(); });

        return Promise.all(pendings)
            .then(function (backendsResult) { return this$1._conflate(backendsResult); })
            .catch(function (err) {
                debug$4('Error after reenumerating: ', err);
                this$1.emit('error', err);
            });
    };


    // Called on the USB attach/detach events, throttles down calls to reenumerate()
    // Only one reenumeration will be active at any one time - if any reenumerations
    // are triggered by events when there is one already active, the first one
    // will be queued and delayed until the active one is finished, the rest
    // will be silently ignored.
    DeviceLister.prototype._triggerReenumeration = function _triggerReenumeration (usbDevice) {
        var this$1 = this;

        debug$4(("Called _triggerReenumeration because of added/removed USB device VID/PID 0x" + (usbDevice.deviceDescriptor.idVendor.toString(16).padStart(4, '0')) + "/0x" + (usbDevice.deviceDescriptor.idProduct.toString(16).padStart(4, '0'))));

        if (!this._activeReenumeration) {
            debug$4('Calling reenumerate().');
            this._activeReenumeration = this.reenumerate().then(function () {
                this$1._activeReenumeration = false;
            });
        } else if (!this._queuedReenumeration) {
            debug$4('Queuing one reenumeration.');
            this._queuedReenumeration = true;

            this._activeReenumeration.then(function () {
                debug$4('Previous reenumeration done, triggering queued one.');

                this$1._activeReenumeration = this$1.reenumerate().then(function () {
                    this$1._activeReenumeration = false;
                });
                this$1._queuedReenumeration = false;
            });
        } else {
            debug$4('Skipping spurious reenumeration request.');
        }
    };


    DeviceLister.prototype._conflate = function _conflate (backendsResult) {
        var this$1 = this;

        debug$4('All backends have re-enumerated, conflating...');

        var deviceMap = new Map();
        var newErrors = new Set();

        backendsResult.forEach(function (results) {
            results.forEach(function (result) {
                if (result.serialNumber) {
                    var serialNumber = result.serialNumber;

                    var device = deviceMap.get(serialNumber) || {};
                    var traits = device.traits;

                    // fix the result by renaming serialport object to
                    // serialport.1 for the 2nd port, serialport.2 for the 3rd...
                    // before merging it to the final device object
                    var fixedResult = result;
                    if (fixedResult.serialport) {
                        var n = Object.keys(device).filter(function (k) { return k.startsWith('serialport'); }).length;
                        if (n > 0) {
                            fixedResult[("serialport." + n)] = result.serialport;
                            delete fixedResult.serialport;
                        }
                    }

                    device = Object.assign({}, device, fixedResult);
                    if (traits && !traits.includes(result.traits[0])) {
                        device.traits = result.traits.concat(traits);
                    }
                    deviceMap.set(serialNumber, device);
                } else if (result.errorSource) {
                    if (!this$1._currentErrors.has(result.errorSource)) {
                        this$1.emit('error', result.error);
                    }
                    newErrors.add(result.errorSource);
                } else {
                    var err = new Error(("Received neither serial number nor error! " + result));
                    err.errorCode = ErrorCodes.RECEIVED_NEITHER_SNO_NOR_ERROR;
                    throw err;
                }
            });
        });

        this._currentErrors = newErrors;

        debug$4(("Conflated. Now " + (Array.from(deviceMap).length) + " devices with known serial number and " + (Array.from(this._currentErrors).length) + " without."));
        this._currentDevices = deviceMap;
        this.emit('conflated', deviceMap);
        return deviceMap;
    };

    Object.defineProperties( DeviceLister, staticAccessors );

    return DeviceLister;
}(EventEmitter));
DeviceLister.ErrorCodes = ErrorCodes;
DeviceLister.getBoardVersion = getBoardVersion;

module.exports = DeviceLister;
//# sourceMappingURL=device-lister.js.map
