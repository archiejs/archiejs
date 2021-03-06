'use strict';
var resolve = require('path').resolve;
var util = require('util');

var debug = require('debug')('archiejs-base-enhancer');

var BaseEnhancer = function () {
    this.enhancerName = "base";
    this.__instantiateBeforeInjection = true; // default
};

let packaging_error_template = "\
Please dont use index.js in module %s \n\
when using a json format for provides. \n\
Suggestion, rename it to a different name as it confuses archie.js \n\
on how to load the module.";

(function () {

    /* resolveConfig modifies the config structure
     * and resolves various dependencies to code
     * in the config.
     *
     * resolveConfig is called when we are loading the config
     * for a wrapped plugin (in resolveConfig in archie.js).
     */

    this.resolveConfig = function (plugin, base) {
        debug('resolveConfig');
        if (!base) {
            throw new Error("base should be provided in arguments (use __dirname)");
        }

        if (!plugin.packagePath)
            throw new Error('packagePath missing in plugin');

        if (!plugin.consumes)
            plugin.consumes = [];

        if (!plugin.provides)
            plugin.provides = [];

        if (typeof plugin.consumes === 'string')
            plugin.consumes = [plugin.consumes];

        if (typeof plugin.provides === 'string')
            plugin.provides = [plugin.provides];

        if (Array.isArray(plugin.provides)) {
            return; // nothing to do
        }

        if (plugin.setup) {
            var err_msg = util.format(packaging_error_template, plugin.packagePath);
            throw new Error(err_msg);
        }

        // provides is a json ( of type, serviceName : file )

        var modulePath = plugin.packagePath;
        var provides = [];
        var consumes = plugin.consumes;
        var providesAsMap = {};

        // creates a flat json with . (dots) in keys, instead of nestings.

        var resolveFn = function (_servMap, prefix) {
            var _servicePath;
            var _serviceName;
            var pathOrObj;

            for (var key in _servMap) {
                pathOrObj = _servMap[key];
                _serviceName = prefix + key;
                if (typeof pathOrObj === 'object') { // nested object
                    resolveFn(pathOrObj, _serviceName + ".");
                    providesAsMap[_serviceName] = pathOrObj;
                } else { // is path
                    _servicePath = resolve(base, modulePath, pathOrObj);
                    _servMap[key] = _servicePath;
                    providesAsMap[_serviceName] = _servicePath; // add shortcut to providers list x.y.z
                }
                provides.push(_serviceName);
            }
        };
        resolveFn(plugin.provides, "");

        plugin.enhancers = providesAsMap; // provided for convenience of other enhancers
        plugin.providesIsJson = true;
        plugin.provides = provides;
    };

    /* This acts as a generic setup function.
     *
     * setupPlugin wraps the object or its instance.
     * It is called when we are initializing the
     * app in Archie.createApp.
     *
     * Inputs :-
     *
     * plugin   - config details
     * imports  - imports
     */

    this.setupPlugin = async function (plugin, imports) {
        var __instantiateBeforeInjection = plugin.__instantiateBeforeInjection || this.__instantiateBeforeInjection;

        debug("setupPlugin");
        debug(plugin);

        if (plugin.setup) {

            // The provides are in array form and the 'main' file has a setup
            // function that will register all exported services of the module.
            let registerObjsOrPromise = plugin.setup(plugin, imports);
            debug(registerObjsOrPromise);
            return registerObjsOrPromise;

        } else {

            // Registers the services provided by the plugin and enhance them
            // (if an enhancer has been specified).

            var _registerObjs = {};

            // 1. for each js file/module, call the register function
            // 2. for non-leaf keys in provides Json, create a flat array (so that a.b.service
            //   can also be consumed, when a consumer wants to consume a specific service).

            var subKey;
            var tmpKey;
            var mkObj;

            var maybePromises = [];

            plugin.provides.forEach(key => {

                if (typeof plugin.enhancers[key] === 'string') {  // leaf
                    debug(`${key} leaf`);

                    var ConstructorFn = require(plugin.enhancers[key]);
                    if (!__instantiateBeforeInjection) {
                        debug(`    is class`);
                        // service is a class and many instances can be created (for example, db schemas in mongodb)

                        _registerObjs[key] = ConstructorFn;

                    } else {
                        debug(`    is instance ${key}`);
                        // service is a singleton

                        _registerObjs[key] = new ConstructorFn(plugin, imports);
                        maybePromises.push(key);
                    }

                } else {  // non-leaf
                    debug(`${key} non-leaf`);

                    mkObj = {};
                    plugin.provides.forEach(function (subKey) {
                        if (key === subKey) { // break when it finds itself
                            return false;
                        }
                        if (subKey.indexOf(key) === 0) { // we found a subKey
                            tmpKey = subKey.slice(key.length + 1);
                            mkObj[tmpKey] = _registerObjs[subKey]; // add
                        }
                    });
                    _registerObjs[key] = mkObj;

                }

            })

            const results = await Promise.all(
                maybePromises.map((key) => _registerObjs[key])
            )
            //debug(results);

            // get registered objects from resolved promises

            for (let idx in results) {
                let key = maybePromises[idx];
                let item = results[idx];
                _registerObjs[key] = item;
            }

            // if any of the register objects are promise ... we should not resolve now

            debug('register done');
            debug(_registerObjs);

            return _registerObjs;
        }

    }

}).call(BaseEnhancer.prototype);

module.exports = BaseEnhancer;
