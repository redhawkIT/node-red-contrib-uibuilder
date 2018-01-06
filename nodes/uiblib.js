/**
 * Copyright (c) 2018 Julian Knight (Totally Information)
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
// @ts-check
'use strict';

module.exports = {
    // Complex, custom code when processing an incoming msg should go here
    // Needs to return the msg object
    inputHandler: function(msg, node, RED, io, ioNs, log) {
        node.rcvMsgCount++

        // If the input msg is a uibuilder control msg, then drop it to prevent loops
        if ( msg.hasOwnProperty('uibuilderCtrl') ) return null

        //setNodeStatus({fill: 'yellow', shape: 'dot', text: 'Message Received #' + node.rcvMsgCount}, node)

        // Remove script/style content if admin settings don't allow
        if ( node.allowScripts !== true ) {
            if ( msg.hasOwnProperty('script') ) delete msg.script
        }
        if ( node.allowStyles !== true ) {
            if ( msg.hasOwnProperty('style') ) delete msg.style
        }

        // pass the complete msg object to the uibuilder client
        // TODO: This should have some safety validation on it!
        if (msg._socketId) {
            ioNs.to(msg._socketId).emit(node.ioChannels.server, msg)
        } else {
            ioNs.emit(node.ioChannels.server, msg)
        }

        log.debug('uibuilder - msg sent to front-end via ws channel, ', node.ioChannels.server, ': ', msg)

        if (node.fwdInMessages) {
            // Send on the input msg to output
            node.send(msg)
            log.debug('uibuilder - msg passed downstream to next node: ', msg)
        }

        return msg
    }, // ---- End of inputHandler function ---- //

    /** Do any complex, custom node closure code here
     * @param {function|null} [done=null]
     * @param {object} node
     * @param {object} RED
     * @param {object} ioNs - Instance of Socket.IO Namespace
     * @param {object} io - Instance of Socket.IO
     * @param {object} app - Instance of ExpressJS app
     * @param {object} log - Winston logging instance
     */
    processClose: function(done = null, node, RED, ioNs, io, app, log) {
        log.debug('uibuilder:nodeGo:on-close:processClose', node.url)

        setNodeStatus({fill: 'red', shape: 'ring', text: 'CLOSED'}, node)

        // Let all the clients know we are closing down
        sendControl({ 'uibuilderCtrl': 'shutdown', 'from': 'server' }, ioNs, node)

        // Disconnect all Socket.IO clients
        const connectedNameSpaceSockets = Object.keys(ioNs.connected) // Get Object with Connected SocketIds as properties
        if ( connectedNameSpaceSockets.length >0 ) {
            connectedNameSpaceSockets.forEach(socketId => {
                ioNs.connected[socketId].disconnect() // Disconnect Each socket
            })
        }
        ioNs.removeAllListeners() // Remove all Listeners for the event emitter
        delete io.nsps[node.ioNamespace] // Remove from the server namespaces

        // We need to remove the app.use paths too as they will be recreated on redeploy
        // we check whether the regex string matches the current node.url, if so, we splice it out of the stack array
        var removePath = []
        var urlRe = new RegExp('^' + escapeRegExp('/^\\' + urlJoin(node.url)) + '.*$');
        app._router.stack.forEach( function(r, i, stack) {
            let rUrl = r.regexp.toString().replace(urlRe, '')
            if ( rUrl === '' ) {
                removePath.push( i )
                // @since 2017-10-15 Nasty bug! Splicing changes the length of the array so the next splice is wrong!
                //app._router.stack.splice(i,1)
            }
        })

        // @since 2017-10-15 - proper way to remove array entries - in reverse order so the ids don't change - doh!
        for (var i = removePath.length -1; i >= 0; i--) {
            app._router.stack.splice(removePath[i],1);
        }

        /*
            // This code borrowed from the http nodes
            // THIS DOESN'T ACTUALLY WORK!!! Static routes don't set route.route
            app._router.stack.forEach(function(route,i,routes) {
                if ( route.route && route.route.path === node.url ) {
                    routes.splice(i,1)
                }
            });
        */

        // This should be executed last if present. `done` is the data returned from the 'close'
        // event and is used to resolve async callbacks to allow Node-RED to close
        if (done) done()
    }, // ---- End of processClose function ---- //

    /** Simple fn to set a node status in the admin interface
     * fill: red, green, yellow, blue or grey
     * @param {object|string} status
     * @param {object} node
     */
    setNodeStatus: function( status, node ) {
        if ( typeof status !== 'object' ) status = {fill: 'grey', shape: 'ring', text: status}

        node.status(status)
    }, // ---- End of setNodeStatus ---- //

    /** Remove leading/trailing slashes from a string
     * @param {string} str
     * @returns {string}
     */
    trimSlashes: function(str) {
        return str.replace(/(^\/*)|(\/*$)/g, '')
    }, // ---- End of trimSlashes ---- //

    /** Joins all arguments as a URL string
     * @see http://stackoverflow.com/a/28592528/3016654
     * @augments {string} URL fragments
     * @returns {string}
     */
    urlJoin: function() {
        var paths = Array.prototype.slice.call(arguments);
        return '/'+paths.map(function(e){return e.replace(/^\/|\/$/g,'');}).filter(function(e){return e;}).join('/');
    }, // ---- End of urlJoin ---- //

    /** Escape a user input string to use in a regular expression
     * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
     * @param {string} string
     * @returns {string} Input string escaped to use in a re
     */
    escapeRegExp: function(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }, // ---- End of escapeRegExp ---- //

    /**  Get property values from an object.
     * Can list multiple properties, the first found (or the default return) will be returned
     * Makes use of RED.util.getMessageProperty
     * @param {object} RED - RED
     * @param {object} myObj - the parent object to search for the props
     * @param {string|array} props - one or a list of property names to retrieve.
     *                               Can be nested, e.g. 'prop1.prop1a'
     *                               Stops searching when the first property is found
     * @param {any} defaultAnswer - if the prop can't be found, this is returned
     * JK @since 2017-08-17 Added
     * @todo Change instances of "in" and "hasOwnProperty" to use this function
     */
    getProps: function(RED,myObj,props,defaultAnswer = []) {
        if ( (typeof props) === 'string' ) {
            props = [props]
        }
        if ( ! Array.isArray(props) ) {
            return undefined
        }
        let ans
        for (var i = 0; i < props.length; i++) {
            try { // errors if an intermediate property doesn't exist
                ans = RED.util.getMessageProperty(myObj, props[i])
                if ( typeof ans !== 'undefined' ) {
                    break
                }
            } catch(e) {
                // do nothing
            }
        }
        return ans || defaultAnswer
    }, // ---- End of getProps ---- //

    /** Output a control msg
     * Sends to all connected clients & outputs a msg to port 2
     * @param {object} msg The message to output
     * @param {object} ioNs Socket.IO instance to use
     * @param {object} node The node object
     * @param {string=} socketId Optional. If included, only send to specific client id
     */
    sendControl: function(msg, ioNs, node, socketId) {
        if (socketId) msg._socketId = socketId

        // Send to specific client if required
        if (msg._socketId) ioNs.to(msg._socketId).emit(node.ioChannels.control, msg)
        else ioNs.emit(node.ioChannels.control, msg)

        if ( (! msg.hasOwnProperty('topic')) && (node.topic !== '') ) msg.topic = node.topic

        // copy msg to output port #2
        node.send([null, msg])
    } // ---- End of getProps ---- //

} // ---- End of module.exports ---- //
