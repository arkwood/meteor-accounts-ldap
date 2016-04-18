Future = Npm.require('fibers/future');
Ldapjs = Npm.require('ldapjs');

// At a minimum, set up LDAP_DEFAULTS.url and .dn according to
// your needs. url should appear as "ldap://your.url.here"
// dn should appear in normal ldap format of comma separated attribute=value
// e.g. "uid=someuser,cn=users,dc=somevalue"
LDAP_DEFAULTS = {
    url: false,
    port: '389',
    dn: false,
    createNewUser: true,
    defaultDomain: false,
    searchResultsProfileMap: false,
    base: null,
    search: '(objectclass=*)',
    ldapsCertificate: false
};
LDAP = {};

/**
 @class LDAP
 @constructor
 */
LDAP.create = function(options) {
    // Set options
    this.options = _.defaults(options, LDAP_DEFAULTS);
    // Make sure options have been set
    try {
        check(this.options.url, String);
    } catch (e) {
        throw new Meteor.Error("Bad Defaults", "Options not set. Make sure to set LDAP_DEFAULTS.url and LDAP_DEFAULTS.dn!");
    }

    this.ldapjs = Ldapjs;
};

/**
 * Attempt to bind (authenticate) ldap
 * and perform a dn search if specified
 *
 * @method ldapCheck
 *
 * @param {Object} options  Object with username, ldapPass and overrides for LDAP_DEFAULTS object.
 * Additionally the searchBeforeBind parameter can be specified, which is used to search for the DN
 * if not provided.
 */
LDAP.create.prototype.ldapCheck = function(options) {
    var self = this;
    options = options || {};

    if (options.hasOwnProperty('username') && options.hasOwnProperty('ldapPass')) {

        var ldapAsyncFut = new Future();


        // Create ldap client
        var fullUrl = self.options.url + ':' + self.options.port;
        var client = null;

        if (self.options.url.indexOf('ldaps://') == 0) {
            client = self.ldapjs.createClient({
                url: fullUrl,
                tlsOptions: {
                    ca: [ self.options.ldapsCertificate ]
                }
            });
        }
        else {
            client = self.ldapjs.createClient({
                url: fullUrl
            });
        }

        // Slide @xyz.whatever from username if it was passed in
        // and replace it with the domain specified in defaults
        var emailSliceIndex = options.username.indexOf('@');
        var username;
        var domain = self.options.defaultDomain;

        // If user appended email domain, strip it out
        // And use the defaults.defaultDomain if set
        if (emailSliceIndex !== -1) {
            username = options.username.substring(0, emailSliceIndex);
            domain = domain || options.username.substring((emailSliceIndex + 1), options.username.length);
        } else {
            username = options.username;
        }


        // DN is provided
        if (self.options.dn !== false) {
            //Attempt to bind to ldap server with provided info
            client.bind(self.options.dn, options.ldapPass, function(err) {
                try {
                    if (err) {
                        // Bind failure, return error
                        throw new Meteor.Error(err.code, err.message);
                    } else {
                        // Bind auth successful
                        // Create return object
                        var retObject = {
                            username: self.options.dn,
                            searchResults: null
                        };
                        // Set email on return object
                        retObject.email = domain ? username + '@' + domain : false;

                        // Return search results if specified
                        if (self.options.searchResultsProfileMap) {

                            // construct list of ldap attributes to fetch
                            var attributes = [];
                            self.options.searchResultsProfileMap.map(function(item) {
                                attributes.push(item.resultKey);
                            });

                            // use base if given, else the dn for the ldap search
                            var searchBase = self.options.base || self.options.dn;
                            var searchOptions = {
                                scope: 'sub',
                                sizeLimit: 1,
                                attributes: attributes,
                                filter: self.options.search
                            }

                            client.search(searchBase, searchOptions, function(err, res) {
                                res.on('searchEntry', function(entry) {
                                    // Add entry results to return object
                                    retObject.searchResults = entry.object;
                                    ldapAsyncFut.return(retObject);
                                });
                            });
                        }
                        // No search results specified, return username and email object
                        else {
                            ldapAsyncFut.return(retObject);
                        }
                    }
                } catch (e) {
                    ldapAsyncFut.return({
                        error: e
                    });
                }
            });
        }
        else if (self.options.searchBeforeBind !== undefined) {
            // dn not provided, search for DN

            // initialize result
            var retObject = {
                username: username,
                email: domain ? username + '@' + domain : false,
                emptySearch: true,
                searchResults: {}
            };

            // compile attribute list to return
            var searchAttributes = ['dn'];
            self.options.searchResultsProfileMap.map(function(item) {
                searchAttributes.push(item.resultKey);
            });


            var filter = self.options.search;
            Object.keys(options.ldapOptions.searchBeforeBind).forEach(function(searchKey) {
                filter = '&' + filter + '(' + searchKey + '=' + options.ldapOptions.searchBeforeBind[searchKey] + ')';
            });
            var searchOptions = {
                scope: 'sub',
                sizeLimit: 1,
                filter: filter
            }

            // perform LDAP search to determine DN
            client.search(self.options.base, searchOptions, function(err, res) {
                retObject.emptySearch = true;
                res.on('searchEntry', function(entry) {
                    retObject.dn = entry.objectName;
                    retObject.username = retObject.dn;
                    retObject.emptySearch = false;

                    // Return search results if specified
                    if (self.options.searchResultsProfileMap) {
                        // construct list of ldap attributes to fetch
                        var attributes = [];
                        self.options.searchResultsProfileMap.map(function (item) {
                            retObject.searchResults[item.resultKey] = entry.object[item.resultKey];
                        });
                    }

                    // use the determined DN to bind
                    client.bind(entry.objectName, options.ldapPass, function(err) {
                        try {
                            if (err) {
                                throw new Meteor.Error(err.code, err.message);
                            }
                            else {
                                ldapAsyncFut.return(retObject);
                            }
                        }
                        catch (e) {
                            ldapAsyncFut.return({
                                error: e
                            });
                        }
                    });
                });
                res.on('end', function(result) {
                    if (retObject.dn === undefined) {
                        ldapAsyncFut.return(retObject);
                    }
                });
            });
        }

        return ldapAsyncFut.wait();

    } else {
        throw new Meteor.Error(403, "Missing LDAP Auth Parameter");
    }

};


// Register login handler with Meteor
// Here we create a new LDAP instance with options passed from
// Meteor.loginWithLDAP on client side
// @param {Object} loginRequest will consist of username, ldapPass, ldap, and ldapOptions
Accounts.registerLoginHandler("ldap", function(loginRequest) {
    // If "ldap" isn't set in loginRequest object,
    // then this isn't the proper handler (return undefined)
    if (!loginRequest.ldap) {
        return undefined;
    }

    // Instantiate LDAP with options
    var userOptions = loginRequest.ldapOptions || {};
    Accounts.ldapObj = new LDAP.create(userOptions);

    // Call ldapCheck and get response
    var ldapResponse = Accounts.ldapObj.ldapCheck(loginRequest);

    if (ldapResponse.error) {
        return {
            userId: null,
            error: ldapResponse.error
        }
    }
    else if (ldapResponse.emptySearch == true) {
        return {
            userId: null,
            error: 'User not found'
        }
    }
    else {
        // Set initial userId and token vals
        var userId = null;
        var stampedToken = {
            token: null
        };

        // Look to see if user already exists
        var user = Meteor.users.findOne({
            username: ldapResponse.username
        });

        // Login user if they exist
        if (user) {
            userId = user._id;

            // Create hashed token so user stays logged in
            stampedToken = Accounts._generateStampedLoginToken();
            var hashStampedToken = Accounts._hashStampedToken(stampedToken);
            // Update the user's token in mongo
            Meteor.users.update(userId, {
                $push: {
                    'services.resume.loginTokens': hashStampedToken
                }
            });
        }
        // Otherwise create user if option is set
        else if (Accounts.ldapObj.options.createNewUser) {
            var userObject = {
                username: ldapResponse.username
            };
            // Set email
            if (ldapResponse.email) userObject.email = ldapResponse.email;

            // Set profile values if specified in searchResultsProfileMap
            if (ldapResponse.searchResults && Accounts.ldapObj.options.searchResultsProfileMap.length > 0) {

                var profileMap = Accounts.ldapObj.options.searchResultsProfileMap;
                var profileObject = {};

                // Loop through profileMap and set values on profile object
                for (var i = 0; i < profileMap.length; i++) {
                    var resultKey = profileMap[i].resultKey;

                    // If our search results have the specified property, set the profile property to its value
                    if (ldapResponse.searchResults.hasOwnProperty(resultKey)) {
                        profileObject[profileMap[i].profileProperty] = ldapResponse.searchResults[resultKey];
                    }

                }
                // Set userObject profile
                userObject.profile = profileObject;
            }


            userId = Accounts.createUser(userObject);
        } else {
            // Ldap success, but no user created
            return {
                userId: null,
                error: "LDAP Authentication succeeded, but no user exists in MongoDB. Either create a user for this email or set LDAP_DEFAULTS.createNewUser to true"
            };
        }

        return {
            userId: userId,
            token: stampedToken.token
        };
    }

    return undefined;
});