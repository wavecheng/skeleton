(function () {
    'use strict';

    angular.module('act-session', ['act-core']);
})();

(function (module) {
    'use strict';

    module.provider('Session', function SessionProvider() {
        var listeners = this.bootListeners = [];

        this.$get = ['$rootScope', '$http', '$storage', '$identity', '$injector', 'serviceUrl',
            function sessionFactory($rootScope, $http, $storage, $identity, $injector, serviceUrl) {
                return new Session($rootScope, $http, $storage, $identity, $injector, listeners, serviceUrl);
            }];
    });

    function Session($rootScope, $http, $storage, $identity, $injector, bootListeners, serviceUrl) {

        this.getUser = function () {
            return this.user;
        };

        this.getUserId = function () {
            return this.user.id;
        };

        this.getUserName = function () {
            return this.user.name;
        };

        this.isLoggedIn = function () {
            if (this.user) return true;
            return false;
        };

        this.isValid = function () {
            var userId = $storage.get("currentUserId"), newLoc = '#/login';

            if (userId && userId.length > 0) {
                if (this.getUserId() === userId) return true;

                //user may have logged out from another window/tab
                //and a new user have logged in
                //redirect to home
                newLoc = '#/home';
            }

            window.location.replace(newLoc);
            window.location.reload();
            return false;
        };

        this.invalidate = function (data) {
            //$rootScope.$broadcast('event:session-invalidating', data);
            this.user = null;
            $storage.remove("currentUserId");
        };

        this.autoLogin = function (options) {
            this.login(null, options);
        };

        this.credentialsLogin = function (userId, password, options) {
            var btoa = userId + ':' + password;
            var authToken = 'Basic ' + window.btoa(btoa);

            this.login(authToken, options);

        };

        this.login = function (authToken, options) {
            var me = this;
            var config = {ignoreAuth: true};
            if (authToken) {
                if (angular.isDefined(options.remember) && options.remember === true) {
                    config.params = {remember_me: "true"};
                } else {
                    config.params = {remember_me: "session"};
                }
                config.params['authToken'] = authToken;
            }

            $http.post(serviceUrl + '/boot', {}, config).success(function (bootData) {

                $storage.set("currentUserId", bootData.userId);

                for (var i = 0, l = bootListeners.length; i < l; i++) {
                    if (angular.isString(bootListeners[i])) {
                        $injector.get(bootListeners[i]).boot(bootData);
                    } else {
                        $injector.invoke(bootListeners[i], null, {bootData: bootData});
                    }
                }

                $identity.getUser(bootData.userId).then(function (user) {
                    me.user = user;
                    var data = {};
                    me.user.groups = {};
                    me.user.roles = {};
                    for (var i = 0, l = bootData.memberOf.length; i < l; i++) {
                        if ($identity.isRole(bootData.memberOf[i])) {
                            me.user.roles[bootData.memberOf[i]] = true;
                        } else {
                            me.user.groups[bootData.memberOf[i]] = true;
                        }
                    }
                    if (options) {
                        if (options.data) data = options.data;
                        if (options.onSuccess) options.onSuccess(me.getUser(), data);
                    }
                    $rootScope.$broadcast('event:session-loggedIn', bootData);
                });

            }).error(function (response) {

                if (options) {
                    if (options.onError) options.onError(response, options.data);
                }
            });
        };

        this.logout = function () {
            this.invalidate();
            $http.post(serviceUrl + '/logout', {ignoreAuth: true}).success(function () {
                window.location.replace('#/login');
                window.location.reload();
            });

        };

        return this;
    }

})(angular.module('act-session'));

(function (module) {
    'use strict';
    module
        .config(['SessionProvider', function (SessionProvider) {
            SessionProvider.bootListeners.push(['$identity', 'ProcessDefinitionCache', 'bootData', function ($identity, ProcessDefinitionCache, bootData) {
                $identity.boot(bootData);
                var definitions = bootData.processDefinitions;
                for (var i = 0, l = definitions.length; i < l; i++) {
                    ProcessDefinitionCache.addProcessDefinition(definitions[i]);
                }
            }]);
        }])

        .run(['Session', '$rootScope', '$location', '$q', '$timeout', '$ui', '$route', 'connectionInterceptor',
            function (Session, $rootScope, $location, $q, $timeout, $ui, $route, connectionInterceptor) {
                var started = false;

                $rootScope.$on('$locationChangeStart', function (event, currentRoute, nextRoute) {
                    if (Session.isLoggedIn()) return;

                    if (currentRoute.indexOf("#/login") < 0) {
                        event.preventDefault();
                    }

                    if (started === false) {
                        started = true;
                        autoLogin();
                    }
                });

                $rootScope.$on('event:session-loggedIn', function (event, data) {
                    if ($rootScope.currentUser && $rootScope.currentUser.id !== Session.getUserId()) {
                        Session.invalidate();
                        window.location.replace('#/home');
                        window.location.reload();
                    }
                    $rootScope.currentUser = Session.getUser();
                    if ($location.path().indexOf("/login") < 0) {
                        $route.reload();
                    } else {
                        $location.path('home');
                        $location.replace();
                    }
                });
                $ui.registerModal('showLogin', function (data) {
                    this.showModal('core/view/login.html', 'LoginController', {
                        credentials: function () {
                            return {userId: '', userPassword: '', data: data || {}};
                        }
                    }, null, null, {size: 'sm', backdrop: 'static', keyboard: false,}, {closeable: false});
                });

                connectionInterceptor.addListener({
                    id: 'session',
                    onRequest: function (config) {
                        if (!config.ignoreAuth && Session.isLoggedIn()) {
                            config.cancelRequest = !Session.isValid();
                        }
                    },
                    onResponseError: function (rejection) {
                        if (rejection.status === 401 && !rejection.config.ignoreAuth) {
                            loginRequired();
                        }
                    }
                });

                function loginRequired() {
                    //Session.invalidate();
                    $ui.showLogin();
                }

                function autoLogin() {
                    Session.autoLogin({
                        data: $location.path(), onSuccess: function () {
                            $rootScope.$broadcast('event:http-loginConfirmed');
                        },
                        onError: function () {

                            var delay = $q.defer();
                            $timeout(delay.resolve, 1000);
                            delay.promise.then(function (result) {
                                loginRequired();
                            });
                        }
                    });
                }
            }]);
})(angular.module('act-session'));

(function (module) {
    'use strict';
    module.config(['$routeProvider', function ($routeProvider) {
        $routeProvider
            .when('/login', {
                title: 'LOGIN'
            })
    }]);
})(angular.module('act-session'));

(function (module) {
    'use strict';
    module.controller('LoginController', ['$scope', '$uibModalInstance', 'credentials', 'Session', function ($scope, $uibModalInstance, credentials, Session) {
        $scope.credentials = credentials;
        $scope.credentials.remember = true;
        $scope.msg = {};

        $scope.submitForm = function (isValid) {
            $scope.msg.type = 'info';
            $scope.msg.msg = "LOADING";
            // As a workaround for autofill issue
            // manually assign userId and userPassword values from elements
            $scope.credentials.userId = document.getElementById('userId').value;
            $scope.credentials.userPassword = document.getElementById('userPassword').value;
            // check userId and userPassword values
            if (isValid || ($scope.credentials.userId !== "" && $scope.credentials.userPassword !== "")) {
                Session.credentialsLogin($scope.credentials.userId, $scope.credentials.userPassword, {
                    data: credentials.data, remember: $scope.credentials.remember,
                    onSuccess: function (user, data) {

                        if ($uibModalInstance)
                            $uibModalInstance.close($scope.credentials);
                    },
                    onError: function (response) {
                        $scope.msg.type = 'error';
                        $scope.msg.msg = "INVALID_CREDENTIALS";
                        $scope.credentials.userId = "";
                        $scope.credentials.userPassword = "";
                    }
                });

            } else {
                $scope.msg.type = 'error';
                $scope.msg.msg = "ENTER_CREDENTIALS";
            }

        };
    }])
})(angular.module('act-session'));

(function () {
    'use strict';

    angular.module('act-process', [])
        .factory('ProcessInstance', ['HistoryTasks', function (HistoryTasks) {
            return {
                updateFromServer: function (update) {
                    if (update) {
                        if (update.endTime === null) {
                            delete update.variables;
                        }
                        angular.extend(this, update);
                    } else {
                        if (this.endTime === null)
                            delete this.variables;
                    }
                },
                refresh: function (forceRefresh) {
                    var me = this;
                    this.getList('../../historic-process-instances', {
                        processInstanceId: this.id,
                        includeProcessVariables: true
                    }).then(
                        function (processInstances) {
                            if (processInstances.length > 0) {
                                me.updateFromServer(processInstances[0]);
                            }
                            //me.updateFromServer(update);

                            me.refreshIdentityLinks(forceRefresh);
                            me.refreshVariables(forceRefresh);
                            me.refreshTasks(forceRefresh);
                            me.refreshActivityIds(forceRefresh);
                        }
                    );

                },
                deleteProcessInstance: function (success, failed) {
                    this.customDELETE("../../../runtime/process-instances/" + this.id).then(success, failed);
                },
                refreshTasks: function (forceRefresh) {
                    if (forceRefresh || !this.tasks) {
                        var me = this;
                        HistoryTasks.getList({processInstanceId: this.id}).then(
                            function (tasks) {
                                me.tasks = tasks;
                            }
                        );
                    }
                },
                refreshVariables: function (forceRefresh, success, failed) {
                    if (forceRefresh || !this.variables) {
                        var me = this;
                        this.getList("../../../runtime/process-instances/" + this.id + "/variables").then(function (variables) {
                            me.variables = variables;
                        });
                    }
                },
                addVariable: function (variable, success, failed) {
                    var me = this;
                    variable.scope = 'local';
                    var variableArr = [variable];
                    this.customPOST(variableArr, "../../../runtime/process-instances/" + this.id + "/variables").then(function () {
                        me.refreshVariables(true);
                    });
                },

                editVariable: function (variable, variableUpdate, success, failed) {
                    var me = this;
                    variable.scope = 'local';
                    variable.customPUT(variableUpdate, variable.name).then(function (updatedVariable) {
                        me.refreshVariables(true);
                    });
                },

                deleteVariable: function (variable, success, failed) {
                    var me = this;
                    variable.customDELETE(variable.name).then(function () {
                        me.refreshVariables(true);
                    });
                },
                refreshIdentityLinks: function (forceRefresh, success, failed) {
                    if (forceRefresh || !this.identityLinks) {
                        var me = this;
                        this.getList("identitylinks").then(function (identityLinks) {
                            for (var i = 0; i < identityLinks.length; i++) {
                                if (identityLinks[i].userId)
                                    identityLinks[i].user = identityLinks[i].userId;
                                else if (identityLinks[i].groupId)
                                    identityLinks[i].group = identityLinks[i].groupId;

                            }
                            me.identityLinks = identityLinks;
                        });
                    }
                },

                addIdentityLink: function (identityLink, success, failed) {
                    var me = this;
                    this.post("../../../runtime/process-instances/" + this.id + "/identitylinks", identityLink, "identitylinks").then(function () {
                        me.refreshIdentityLinks(true);
                    });
                },

                deleteIdentityLink: function (identityLink, success, failed) {
                    var me = this;
                    var link = 'users/' + identityLink.userId + '/' + identityLink.type;
                    this.customDELETE('../../../runtime/process-instances/' + this.id + '/identitylinks/' + link).then(function () {
                        me.refreshIdentityLinks(true);
                    });
                },

                refreshActivityIds: function (forceRefresh, success, failed) {
                    if (forceRefresh || !this.activities) {
                        var me = this;
                        this.getList("../../../runtime/executions/" + this.id + "/activities").then(function (activities) {
                            me.activities = activities;
                        });
                    }
                }
            };
        }])


        // .controller('StartProcessModalInstanceCtrl', ["$scope", "$uibModalInstance", "ProcessDefinitionCache", function ($scope, $uibModalInstance, ProcessDefinitionCache) {
        //     var itemList = ProcessDefinitionCache.getProcessDefinitions(true);
        //
        //     $scope.itemList = itemList;
        //     $scope.selectedItems = [];
        //     $scope.filteredList = angular.copy(itemList);
        //
        //     $scope.ok = function (selectedDefinitions) {
        //         if (selectedDefinitions.length <= 0) {
        //             $scope.showErrors = true;
        //             return;
        //         }
        //         $uibModalInstance.close(selectedDefinitions[0]);
        //         //ProcessManager.startProcess(selectedDefinitions[0]);
        //     };
        //
        //     $scope.cancel = function () {
        //         $uibModalInstance.dismiss('cancel');
        //     };
        //
        // }])
        // .controller('CreateEditModelCtrl', ["$scope", "$uibModalInstance", "options", function ($scope, $uibModalInstance, options) {
        //     var model = {};
        //     if (options.model) {
        //         model.name = options.model.name;
        //         model.metaInfo = options.model.metaInfo;
        //         model.category = options.model.category;
        //         $scope.title = 'EDIT_MODEL';
        //     } else {
        //         $scope.title = 'NEW_MODEL';
        //     }
        //
        //     $scope.showErrors = false;
        //     $scope.model = model;
        //
        //     $scope.submitForm = function (isValid) {
        //         // check to make sure the form is completely valid
        //         if (isValid) {
        //             $uibModalInstance.close($scope.model);
        //         } else {
        //             $scope.showErrors = true;
        //         }
        //     };
        //
        //     $scope.cancel = function () {
        //         $uibModalInstance.dismiss('cancel');
        //     };
        //
        // }]);
        // .run(['ProcessManager', '$ui', function (ProcessManager, $ui) {
        //     $ui.registerModal('showStartNewProcess', function (onOK, onCancel) {
        //         this.showModal('process/view/startProcess.html', 'StartProcessModalInstanceCtrl', {}, function (definition) {
        //             ProcessManager.startProcess(definition, function (processInstance) {
        //                 if (processInstance) {
        //                     $ui.showNotification({
        //                         type: 'success',
        //                         translateKey: 'NOT_PROCESS_STARTED',
        //                         translateValues: {id: processInstance.id, name: definition.name}
        //                     });
        //                 }
        //             });
        //         }, onCancel);
        //     });
        //     $ui.registerModal('showNewModel', function (onOK, onCancel) {
        //         this.showModal('core/view/editModel.html', 'CreateEditModelCtrl', {
        //             options: function () {
        //                 return {};
        //             }
        //         }, onOK, onCancel);
        //     });
        //
        //     $ui.registerModal('showEditModel', function (model, onOK, onCancel) {
        //         this.showModal('core/view/editModel.html', 'CreateEditModelCtrl', {
        //             options: function () {
        //                 return {model: model};
        //             }
        //         }, onOK, onCancel);
        //     });
        // }]);

})();

(function (module) {
    'use strict';
    module
        .factory('ProcessDefinitionPageViewModel', ['ListPage', 'ProcessDefinitions', '$ui', 'ProcessManager', function (ListPage, ProcessDefinitions, $ui, ProcessManager) {
            return angular.extend({
                loaded: false,
                template: 'core/view/listPage.html',
                listControlsTemplate: 'process/view/definition/listControls.html',
                listTemplate: 'process/view/definition/list.html',
                section: '',
                requestParam: {start: 0, order: 'desc', sort: 'id'},
                listSize: 10,
                queryResource: ProcessDefinitions,
                start: function (definition) {
                    ProcessManager.startProcess(definition, function (processInstance) {
                        if (processInstance) {
                            $ui.showNotification({
                                type: 'success',
                                translateKey: 'NOT_PROCESS_STARTED',
                                translateValues: {id: processInstance.id, name: definition.name}
                            });
                        }
                    });
                }
            }, ListPage);
        }])

        .factory('ProcessInstancesPage', ['ListPage', 'HistoricProcessInstances', 'ProcessInsatnceCache', '$ui',
            function (ListPage, HistoricProcessInstances, ProcessInsatnceCache, $ui) {

                var processInstancesPage = angular.extend({}, ListPage);
                return angular.extend(processInstancesPage, {
                    requestParam: {start: 0, order: 'desc', sort: 'processInstanceId', finished: false},
                    template: 'core/view/listPage.html',
                    listControlsTemplate: 'process/view/listControls.html',
                    listTemplate: 'process/view/list.html',
                    itemControlsTemplate: 'process/view/itemControls.html',
                    itemTemplate: 'process/view/item.html',
                    itemName: 'processInstance',
                    sortKeys: {processInstanceId: 'id', startTime: 'startTime'},
                    listSize: 10,
                    queryResource: HistoricProcessInstances,
                    cache: ProcessInsatnceCache,
                    queryList: function (requestParam, success, fail) {
                        if (!this.list || requestParam.processInstanceId)
                            return this.queryResource.getList(requestParam).then(success, fail);

                        return this.queryResource.getList(requestParam).then(function (list) {
                            // force cached process instances to refresh activityIds
                            for (var i = 0; i < list.length; i++) {
                                if (list[i].definition && list[i].definition.graphicalNotationDefined && list[i].activities)
                                    list[i].refreshActivityIds(true);
                            }
                            success(list);
                        }, fail);
                    },
                    queryOne: function (processInstanceId, success, fail) {
                        var requestParams = {processInstanceId: processInstanceId};
                        angular.extend(requestParams, this.requestParam);
                        requestParams.start = 0;
                        return this.queryList(requestParams, function (processInstances) {
                            if (processInstances.length === 0) {
                                fail();
                            } else {
                                success(processInstances[0]);
                            }
                        }, fail);
                    },
                    refreshProcessInstance: function (processInstance) {
                        var me = this;
                        this.queryOne(processInstance.id, function (updatedProcessInstance) {

                            updatedProcessInstance.refreshIdentityLinks(true);
                            updatedProcessInstance.refreshVariables(true);
                            updatedProcessInstance.refreshTasks(true);
                            updatedProcessInstance.refreshActivityIds(true);
                        }, function () {
                            me.back(true);
                        });
                    },
                    deleteProcessInstance: function (processInstance) {
                        var me = this;
                        var name = processInstance.name || processInstance.definition.name;
                        $ui.showConfirmation('CONFIRM_DELETE_PROCESS', {
                                id: processInstance.id,
                                name: name
                            }, function () {
                                processInstance.deleteProcessInstance(
                                    function () {
                                        me.back(true);
                                        me.cache.remove(processInstance.id);
                                        $ui.showNotification({
                                            type: 'info',
                                            translateKey: 'NOT_PROCESS_DELETE_OK',
                                            translateValues: {id: processInstance.id, name: name}
                                        });
                                    },
                                    function (response) {
                                        //TODO handle error response
                                        me.back(true);
                                        me.cache.remove(processInstance.id);
                                        $ui.showNotification({
                                            type: 'danger',
                                            translateKey: 'NOT_PROCESS_DELETE_FAIL',
                                            translateValues: {id: processInstance.id, name: name}
                                        });
                                    }
                                );
                            }
                        );

                    },
                    showEditVar: function (processInstance, variable) {
                        $ui.showEditVar(processInstance, variable);
                    },
                    showAddVar: function (processInstance) {
                        $ui.showAddVar(processInstance);
                    },
                    addIdentityLink: function (processInstance) {
                        $ui.showAddIdentityLink('user', ['participant', 'candidate'], 'INVOLVE_TO_PROCESS', function (identityLink) {
                            processInstance.addIdentityLink(identityLink);
                        });
                    },
                    deleteIdentityLink: function (processInstance, identityLink) {
                        $ui.showConfirmation('CONFIRM_DeleteUserLink', {
                                user: identityLink.userId,
                                type: identityLink.type
                            }, function () {
                                processInstance.deleteIdentityLink(identityLink);
                            }
                        );
                    }
                });
            }])
        .factory('HistoricProcessInstancesPage', ['ListPage', 'HistoricProcessInstances', 'ProcessInsatnceCache',
            function (ListPage, HistoricProcessInstances, ProcessInsatnceCache) {
                var archivedProcessInstancesPage = angular.extend({}, ListPage);
                return angular.extend(archivedProcessInstancesPage, {
                    requestParam: {
                        start: 0,
                        order: 'desc',
                        sort: 'processInstanceId',
                        finished: true,
                        includeProcessVariables: true
                    },
                    template: 'core/view/listPage.html',
                    listControlsTemplate: 'archivedProcess/view/listControls.html',
                    listTemplate: 'archivedProcess/view/list.html',
                    itemControlsTemplate: 'archivedProcess/view/itemControls.html',
                    itemTemplate: 'archivedProcess/view/item.html',
                    itemName: 'processInstance',
                    sortKeys: {processInstanceId: 'id', startTime: 'startTime', endTime: 'endTime'},
                    listSize: 10,
                    queryResource: HistoricProcessInstances,
                    cache: ProcessInsatnceCache,
                    getItem: function (processInstanceId) {
                        var processInstance = this.cache.get(processInstanceId);
                        if (processInstance) {
                            if (processInstance.endTime !== null)
                                return processInstance;
                            this.cache.remove(processInstanceId);
                        }
                    }
                });
            }])

        .service('ProcessPageViewModels', ["Session", "ProcessDefinitionPageViewModel", "ProcessInstancesPage", "HistoricProcessInstancesPage",
            function (Session, ProcessDefinitionPageViewModel, ProcessInstancesPage, HistoricProcessInstancesPage) {
                var definitionListPage = angular.extend({}, ProcessDefinitionPageViewModel),
                    myInstancesListPage = createProcessInstanceListPage('myinstances', 'startedBy'),
                    participantListPage = createProcessInstanceListPage('participant', 'involvedUser'),
                    archivedListPage = createArchivedProcessInstanceListPage('archived', 'involvedUser');

                this.getDefinition = function (definitionId) {
                    return definitionListPage.show(definitionId);
                };
                this.getMyInstances = function (processInstanceId) {
                    return myInstancesListPage.show(processInstanceId);
                };
                this.getParticipant = function (processInstanceId) {
                    return participantListPage.show(processInstanceId);
                };
                this.getArchived = function (processInstanceId) {
                    return archivedListPage.show(processInstanceId);
                };

                function createProcessInstanceListPage(section, param) {
                    var listPage = angular.extend({section: section}, ProcessInstancesPage);
                    listPage.requestParam = angular.extend({}, ProcessInstancesPage.requestParam);
                    listPage.requestParam[param] = Session.getUserId();
                    return listPage;
                }

                function createArchivedProcessInstanceListPage(section, param) {
                    var listPage = angular.extend({section: section}, HistoricProcessInstancesPage);
                    listPage.requestParam = angular.extend({}, HistoricProcessInstancesPage.requestParam);
                    listPage.requestParam[param] = Session.getUserId();
                    return listPage;
                }

            }]);
})(angular.module('act-process'));

(function (module) {
    module
        .service('ProcessManager', ["ProcessDefinitionCache", "$ui", "ProcessInstances", "ProcessDefinitions",
            function (ProcessDefinitionCache, $ui, ProcessInstances, ProcessDefinitions) {
                function fetchProcessDefinition(processDefinitionId) {
                    return ProcessDefinitions.one(processDefinitionId).withHttpConfig({cache: true}).get();
                }

                this.getProcessDefinition = function (processDefinitionId) {
                    var processDefinition = ProcessDefinitionCache.getProcessDefinition(processDefinitionId);
                    if (processDefinition !== null) return processDefinition;
                    return fetchProcessDefinition(processDefinitionId);
                };

                this.startProcess = function (definition, success, failure) {
                    $ui.showStartForm(definition, {
                        title: 'START_PROCESS',
                    }, function (processInstance) {
                        //No start form
                        startProcess(definition, null, success, failure);

                    }, success, failure);
                };

                function startProcess(definition, variables, success, failure) {
                    var data = {processDefinitionId: definition.id};
                    if (variables && variables.length > 0)
                        data.variables = variables;
                    ProcessInstances.post(data).then(success, failure);
                };
            }]);
})(angular.module('act-process'));

(function (module) {
    'use strict';
    module
        .factory('ProcessDefinitionCache', function () {
            var definitions = {};

            return {
                addProcessDefinition: function (processDefinition) {
                    var keyVersionId = processDefinition.id.split(':');
                    if (definitions[keyVersionId[0]] === undefined) {
                        definitions[keyVersionId[0]] = {};
                    }
                    definitions[keyVersionId[0]][keyVersionId[1]] = processDefinition;
                },
                getProcessDefinition: function (processDefinitionId) {
                    var keyVersionId = processDefinitionId.split(':');
                    if (definitions[keyVersionId[0]]) {
                        if (definitions[keyVersionId[0]][keyVersionId[1]]) return definitions[keyVersionId[0]][keyVersionId[1]];
                    }
                    return null;
                },
                getProcessDefinitions: function (lastestVersionsOnly) {
                    var processDefinitions = [];
                    for (var key in definitions) {
                        if (lastestVersionsOnly && lastestVersionsOnly === true) {
                            processDefinitions.push(getProcessDefinitionLatestVersion(definitions[key]));
                        } else {
                            processDefinitions.push(definitions[key]);
                        }
                    }
                    return processDefinitions;
                }
            };

            function getProcessDefinitionLatestVersion(processDefinitions) {
                var latestVersion = -1;
                for (var version in processDefinitions) {
                    if (processDefinitions[version].version > latestVersion)
                        latestVersion = processDefinitions[version].version;
                }
                return processDefinitions[latestVersion];
            }
        })
        .factory('ProcessInsatnceCache', ['$cacheFactory', function ($cacheFactory) {
            return $cacheFactory('process-instance-cache');
        }]);
})(angular.module('act-process'));

(function (module) {
    'use strict';
    module.config(['$routeProvider', function ($routeProvider) {
        $routeProvider
            .when('/processes/definitions', {
                title: 'DEFINITIONS',
                resolve: {
                    page: ['ProcessPageViewModels', function (ProcessPageViewModels) {
                        return ProcessPageViewModels.getDefinition();
                    }]
                }
            })
            .when('/processes/myinstances/:processInstanceId?', {
                title: 'MYINSTANCES',
                resolve: {
                    page: ["ProcessPageViewModels", "$route", function (ProcessPageViewModels, $route) {
                        return ProcessPageViewModels.getMyInstances($route.current.params.processInstanceId);
                    }]
                }
            })
            .when('/processes/participant/:processInstanceId?', {
                title: 'PARTICIPANT',
                resolve: {
                    page: ["ProcessPageViewModels", "$route", function (ProcessPageViewModels, $route) {
                        return ProcessPageViewModels.getParticipant($route.current.params.processInstanceId);
                    }]
                }
            })
            .when('/processes/archived/:processInstanceId?', {
                title: 'ARCHIVED',
                resolve: {
                    page: ["ProcessPageViewModels", "$route", function (ProcessPageViewModels, $route) {
                        return ProcessPageViewModels.getArchived($route.current.params.processInstanceId);
                    }]
                }
            });
    }]);
})(angular.module('act-process'));

(function(module) {
    module
        .filter('definitionName', ["ProcessDefinitionCache", function (ProcessDefinitionCache) {
            return function (processDefinitionId) {
                if (processDefinitionId) {
                    var processDefinition = ProcessDefinitionCache.getProcessDefinition(processDefinitionId);
                    if (processDefinition !== null) return processDefinition.name;
                }
                return processDefinitionId;
            };
        }]);
})(angular.module('act-process'));

(function (module) {
    module
        .factory('ProcessDefinitions', ['RepositoryRestangular', 'ProcessDefinitionCache', function (RepositoryRestangular, ProcessDefinitionCache) {
            return RepositoryRestangular.withConfig(function (RestangularConfigurer) {
                RestangularConfigurer.setResponseExtractor(function (response) {
                    if (angular.isArray(response)) {
                        for (var i = 0, l = response.length; i < l; i++) {
                            ProcessDefinitionCache.addProcessDefinition(angular.copy(response[i]));
                        }
                    } else {
                        ProcessDefinitionCache.addProcessDefinition(angular.copy(response));
                    }
                    return response;
                });
            }).service('process-definitions');
        }])
        .factory('Models', ['RepositoryRestangular', function (RepositoryRestangular) {
            return RepositoryRestangular.service('models');
        }])
        //Restangulars factories
        .factory('RuntimeRestangular', ['Restangular', 'serviceUrl', function (Restangular, serviceUrl) {
            return Restangular.withConfig(function (RestangularConfigurer) {
                RestangularConfigurer.setBaseUrl(serviceUrl + '/runtime/');
            });
        }])
        .factory('RepositoryRestangular', ['Restangular', 'serviceUrl', function (Restangular, serviceUrl) {
            return Restangular.withConfig(function (RestangularConfigurer) {
                RestangularConfigurer.setBaseUrl(serviceUrl + '/repository/');
                /* RestangularConfigurer.setDefaultHttpFields({cache: true});*/
            });
        }])
        /*.factory('FormRestangular', function(Restangular) {
         return Restangular.withConfig(function(RestangularConfigurer) {
         RestangularConfigurer.setBaseUrl('service/form/');
         });
         })*/
        .factory('HistoryRestangular', ['Restangular', 'serviceUrl', function (Restangular, serviceUrl) {
            return Restangular.withConfig(function (RestangularConfigurer) {
                RestangularConfigurer.setBaseUrl(serviceUrl + '/history/');
            });
        }])
        .factory('ProcessInstances', ['RuntimeRestangular', function (RuntimeRestangular) {
            return RuntimeRestangular.service('process-instances');
        }])
        .factory('HistoricProcessInstances', ['HistoryRestangular', 'ProcessInsatnceCache', '$q', 'ProcessInstance', 'ProcessManager',
            function (HistoryRestangular, ProcessInsatnceCache, $q, ProcessInstance, ProcessManager) {
                return HistoryRestangular.withConfig(function (RestangularConfigurer) {
                    RestangularConfigurer.extendModel('historic-process-instances', function (processInstance) {
                        if (processInstance.fromServer === false) return processInstance;

                        var cachedProcessInstance = ProcessInsatnceCache.get(processInstance.id);
                        if (cachedProcessInstance) {
                            cachedProcessInstance.updateFromServer(processInstance);
                            return cachedProcessInstance;
                        }

                        ProcessInsatnceCache.put(processInstance.id, processInstance);

                        $q.when(ProcessManager.getProcessDefinition(processInstance.processDefinitionId))
                            .then(function (definition) {
                                processInstance.definition = definition;
                            });
                        processInstance = angular.extend(processInstance, ProcessInstance);
                        processInstance.updateFromServer();
                        return processInstance;
                    });
                }).service('historic-process-instances');
            }])
})(angular.module('act-process'));

(function() {'use strict';

/* agLocale */

angular.module('agLocale', ['pascalprecht.translate'])

    // this inflect uib datepicker
// .run(["$rootScope", "$translate", "localeTable", function($rootScope, $translate, localeTable){
// 	$rootScope.$on("$translateChangeSuccess", function(){
// 		localeTable.setLocale($translate.use());
// 	});
// }]);

})();

angular.module('agLocale')

    .factory('localeLoader', ["$http", "$q", "localeTable",function ($http, $q, localeTable) {
        return function (options) {
            var deferred = $q.defer();

            $http.get('resources/localization/'+options.key+'.json').success(function (data){
                deferred.resolve(data.translations);
                localeTable.addLocale(options.key, data);
            }).error(function (data){
                deferred.reject(options.key);
            });

            return deferred.promise;
        };
    }])

    .factory('localeTable', ['$locale', function ($locale) {
        var locales = {};
        function changeLocale(oldLocale, newLocale) {
            angular.forEach(oldLocale, function(value, key) {
                if (!newLocale[key]) {
                    delete oldLocale[key]; // maybe old locale key shouldn't be deleted
                } else if (angular.isArray(newLocale[key])) {
                    oldLocale[key].length = newLocale[key].length;
                }
            });
            angular.forEach(newLocale, function(value, key) {
                if (angular.isArray(newLocale[key]) || angular.isObject(newLocale[key])) {
                    if (!oldLocale[key]) {
                        oldLocale[key] = angular.isArray(newLocale[key]) ? [] : {};
                    }
                    changeLocale(oldLocale[key], newLocale[key]);
                } else {
                    // pluralCat is a function
                    if("pluralCat" === key){
                        oldLocale[key] = new Function('return ' + newLocale[key])();
                    }else{
                        oldLocale[key] = newLocale[key];
                    }

                }
            });
        };

        return {
            addLocale: function(key, locale){
                locales[key] = locale;
                if(locale.relativeTime){
                    moment.locale(key, {relativeTime: locale.relativeTime});
                }
            },
            getLocale: function(key){
                return locales[key];
            },
            setLocale: function(key){
                changeLocale($locale, locales[key].locale);
                moment.locale(key);
            }
        };
    }])

    .factory('translateStorage', ['$storage', function ($storage) {
        var langKey;
        return {
            get: function (name) {
                if(!langKey) {
                    langKey = $storage.get(name);
                }
                return langKey;
            },

            put: function (name, value) {
                langKey=value;
                $storage.set(name, value);
            }
        };
    }])

angular.module('agLocale')
    .controller('LanguageController', ['$scope', '$translate', 'localeKeys', function ($scope, $translate, localeKeys) {
    $scope.langs = localeKeys.langDisplay;
    $scope.lang = $translate.use();

    $scope.setLang = function (lang) {
        $translate.use(lang).then(function(){
            $scope.lang = $translate.use();
        });
    };
}]);

angular.module('act-core', [
    'ngAnimate',
    'ngSanitize',
    'ui.bootstrap',
    'ui.router',
    'agLocale',
    'restangular',
    'ngRoute',
    'ui.grid',
    'ui.grid.selection'
]);

angular.module('act-core')
// .constant('serviceUrl', 'http://10.150.139.150:8080/act/service');
//     .constant('serviceUrl', 'http://localhost:8080/actangular/service');
// .constant('serviceUrl', 'http://localhost:8080/act/service');
    .constant('serviceUrl', '/account');


angular.module('act-core')
    .provider('toastr', function toastrProvider() {
        var _options;

        this.setToastrOptions = function(options) {
            _options = options;
        };

        this.$get = ['$window', function($window) {
            var toastr = $window.toastr;
            if(_options) {
                toastr.options = _options;
            }
            return $window.toastr;
        }];
    })
    .config(['toastrProvider', function(toastrProvider) {
        toastrProvider.setToastrOptions({
            'closeButton': false,
            'debug': false,
            'newestOnTop': false,
            'progressBar': false,
            'positionClass': 'toast-bottom-right',
            'preventDuplicates': false,
            'onclick': null,
            'showDuration': '300',
            'hideDuration': '1000',
            'timeOut': '5000',
            'extendedTimeOut': '1000',
            'showEasing': 'swing',
            'hideEasing': 'linear',
            'showMethod': 'fadeIn',
            'hideMethod': 'fadeOut'
        });
    }]);

(function () {
    'use strict';

    function $otherwise(handler) {
        this.get = function (key, params) {
            return handler.get(key, params);
        };
    };

    angular.module('act-ui', ['ui.bootstrap', 'selectionModel', 'angularFileUpload'])
        .provider('$otherwise', function $OtherwiseProvider() {

            var handler = null;
            this.setHandler = function (otherwiseHandler) {
                handler = otherwiseHandler;
            };

            this.$get = ['$injector', function sessionFactory($injector) {
                if (handler) {
                    return new $otherwise($injector.get(handler));
                } else {
                    return new $otherwise({
                        get: function (key) {
                            return key;
                        }
                    });
                }

            }];
        })
        .constant('attachmentIcons',
            {
                'image': 'fa fa-file-image-o', 'compressed': 'fa fa-file-archive-o',
                'application/pdf': 'fa fa-file-pdf-o', 'application/msword': 'fa fa-file-word-o'
            })

        .config(['$uibTooltipProvider',
            function ($tooltipProvider) {
                $tooltipProvider.options({appendToBody: true});
            }])
        .factory('connectionInterceptor', ['$q', function ($q) {
            var listenerHandler = {
                listeners: {},
                addListener: function (listener) {
                    this.listeners[listener.id] = listener;
                },
                removeListener: function (listenerId) {
                    delete this.listeners[listenerId];
                },
                onRequest: function (config) {
                    this.notifyListeners('onRequest', config);
                },
                onResponse: function (response) {
                    this.notifyListeners('onResponse', response);
                },
                onRequestError: function (rejection) {
                    this.notifyListeners('onRequestError', rejection);
                },
                onResponseError: function (rejection) {
                    this.notifyListeners('onResponseError', rejection);
                },
                notifyListeners: function (eventId, param) {
                    for (var listenerId in this.listeners)
                        if (this.listeners[listenerId][eventId])
                            this.listeners[listenerId][eventId](param);
                }
            };
            return {
                addListener: function (listener) {
                    listenerHandler.addListener(listener);
                },
                removeListener: function (listenerId) {
                    listenerHandler.removeListener(listenerId);
                },
                request: function (config) {
                    listenerHandler.onRequest(config);

                    if (config && config.cancelRequest) {
                        /* request cancellation was requested */
                        return $q.reject(config);
                    }
                    return config || $q.when(config);
                },
                requestError: function (rejection) {
                    listenerHandler.onRequestError(rejection);
                    return $q.reject(rejection);
                },
                response: function (response) {
                    listenerHandler.onResponse(response);
                    return response || $q.when(response);
                },
                responseError: function (rejection) {
                    listenerHandler.onResponseError(rejection);
                    return $q.reject(rejection);
                }
            };

        }])
        .config(['$httpProvider', function ($httpProvider) {
            $httpProvider.interceptors.push('connectionInterceptor');
        }])
        .service('$ui', ["$uibModal", "$rootScope", "$location", function ($uibModal, $rootScope, $location) {
            var opennedModals = {};

            $rootScope.$on('$locationChangeStart', function (event, currentRoute, prevRoute) {
                if (opennedModals.current) {
                    if (opennedModals.current.closeOption && opennedModals.current.closeOption.closeable === false) return;
                    opennedModals.current.dismiss('cancel');
                    delete opennedModals.current;
                }
            });
            this.register = function (uiName, handler) {
                this[uiName] = handler;
            };
            this.registerModal = function (modalName, handler) {
                this[modalName] = handler;
            };
            this.showModal = function (templateUrl, controller, resolve, onOK, onCancel, modalOptions, closeOption) {
                var options = {templateUrl: templateUrl, controller: controller, resolve: resolve};
                if (modalOptions)
                    angular.extend(options, modalOptions);

                var modalInstance = $uibModal.open(options);
                modalInstance.result.then(function (result) {
                    delete opennedModals.current;
                    if (onOK)
                        onOK(result);

                }, function () {
                    delete opennedModals.current;
                    if (onCancel)
                        onCancel();
                });

                modalInstance.opened.then(function () {
                    opennedModals.current = modalInstance;
                    if (closeOption)
                        opennedModals.current.closeOption = closeOption;
                });
            };

            this.showConfirmation = function (msg, params, onOK, onCancel) {
                this.showModal('common/view/confirmation.html', 'ConfirmationController', {
                    options: function () {
                        return {msg: msg, msgParams: params};
                    }
                }, onOK, onCancel);
            };

            this.showSelectIdentity = function (identityType, title, onOK, onCancel) {
                var options = {
                    options: function () {
                        return {title: title, identityType: identityType};
                    }
                };
                this.showModal('common/view/selectIdentity.html', 'SelectIdentityController', options, onOK, onCancel);
            };

            this.showAddIdentityLink = function (identityType, roles, title, onOK, onCancel) {
                var options = {
                    options: function () {
                        return {title: title, roles: roles, identityType: identityType};
                    }
                };
                this.showModal('common/view/addIdentityLink.html', 'AddIdentityController', options, onOK, onCancel);
            };

            this.showPostComment = function (resource) {
                this.showModal('common/view/postComment.html', 'CommentController', {
                    resource: function () {
                        return resource;
                    }
                });
            };

            this.showAddVar = function (resource) {
                this.showModal('common/view/addVar.html', 'AddVarController', {
                    resource: function () {
                        return resource;
                    }
                });
            };

            this.showEditVar = function (resource, variable) {
                this.showModal('common/view/editVar.html', 'EditVarController', {
                    options: function () {
                        return {resource: resource, variable: variable};
                    }
                });
            };

            return this;
        }])
        .controller('NotificationsController', ['$scope', '$timeout', '$ui', function ($scope, $timeout, $ui) {
            $scope.alerts = {};
            $scope.alertCount = 0;

            $scope.addAnAlert = function (notification) {
                var index = $scope.alertCount;
                $scope.alertCount++;
                var onTimeout = function () {
                    $scope.closeAlert(index);
                };
                var timeout = notification.timeout || 8000;
                if (timeout > 0)
                    $timeout(onTimeout, timeout);
                var alert = {id: '' + index};
                $scope.alerts['alert' + index] = angular.extend(alert, notification);
                return index;
            };

            $scope.closeAlert = function (index) {
                delete $scope.alerts['alert' + index];
            };

            $ui.register('showNotification', function (notification) {
                $scope.addAnAlert(notification);
            });

        }])

        .directive('agNotifications', function () {
            return {
                controller: 'NotificationsController',
                templateUrl: 'core/view/notifications.html'
            };
        })
        .controller('AgModalController', ['$scope', '$uibModalInstance', '$injector', 'options',
            function ($scope, $uibModalInstance, $injector, options) {
                if (options.title)
                    $scope.title = options.title;

                $scope.cancel = function () {
                    $uibModalInstance.dismiss('cancel');
                };

                if (options.handler) {
                    var handler = options.handler;
                    if (angular.isString(handler)) {
                        handler = $injector.get(handler);
                        $injector.invoke(handler.handle, handler, {
                            scope: $scope,
                            modal: $uibModalInstance,
                            options: options
                        });
                    } else {
                        $injector.invoke(handler, null, {scope: $scope, modal: $uibModalInstance, options: options});
                    }
                }
            }])
        .controller('ConfirmationController', ['$scope', '$uibModalInstance', 'options', function ($scope, $uibModalInstance, options) {
            $scope.msg = options.msg;
            $scope.msgParams = options.msgParams;
            $scope.ok = function () {
                $uibModalInstance.close();
            };
            $scope.cancel = function () {
                $uibModalInstance.dismiss('cancel');
            };
        }])
        .controller('CommentController', ['$scope', '$uibModalInstance', 'resource', function ($scope, $uibModalInstance, resource) {
            $scope.showErrors = false;
            $scope.submitForm = function (isValid, comment) {
                // check to make sure the form is completely valid
                if (!isValid) {
                    $scope.showErrors = true;
                    return;
                }

                resource.addComment(comment);
                $uibModalInstance.close();
            };

            $scope.cancel = function () {
                $uibModalInstance.dismiss('cancel');
            };

        }])
        .controller('AddVarController', ['$scope', '$uibModalInstance', 'resource', function ($scope, $uibModalInstance, resource) {
            $scope.ok = function (isValid, variable) {

                // check to make sure the form is completely valid
                if (!isValid) {
                    $scope.showErrors = true;
                    return;
                }

                resource.addVariable(variable);
                $uibModalInstance.close();
            };

            $scope.checkDuplicate = function (name) {
                for (var i = 0, l = resource.variables.length; i < l; i++) {
                    if (name === resource.variables[i].name) {
                        return true;
                    }
                }
                return false;
            };
            $scope.cancel = function () {
                $uibModalInstance.dismiss('cancel');
            };

        }])
        .controller('EditVarController', ['$scope', '$uibModalInstance', 'options', function ($scope, $uibModalInstance, options) {

            var theVariable = {
                name: options.variable.name,
                type: options.variable.type,
                dateValue: '',
                stringValue: '',
                numberValue: 0
            };

            if (options.variable.type) {
                if (options.variable.type === 'string') theVariable.stringValue = options.variable.value;
                else if (options.variable.type === 'long') theVariable.numberValue = options.variable.value;
                else if (options.variable.type === 'date') theVariable.dateValue = new Date(options.variable.value);
            } else {
                theVariable.type = 'string';
            }

            $scope.variable = theVariable;

            $scope.ok = function (isValid, variable) {

                // check to make sure the form is completely valid
                if (!isValid) {
                    $scope.showErrors = true;
                    return;
                }

                var updatedVariable = {name: variable.name, type: variable.type};

                if (variable.type === 'string') updatedVariable.value = variable.stringValue;
                else if (variable.type === 'long') updatedVariable.value = variable.numberValue;
                else if (variable.type === 'date') updatedVariable.value = variable.dateValue;

                options.resource.editVariable(options.variable, updatedVariable);

                $uibModalInstance.close();
            };

            $scope.deleteVar = function (variable) {
                options.resource.deleteVariable(options.variable);
                $uibModalInstance.close();
            };

            $scope.cancel = function () {
                $uibModalInstance.dismiss('cancel');
            };

        }])
        .directive('agNav', ['$location', function ($location) {
            return function (scope, element, attrs) {

                var matchSub = attrs.navSub || true;

                function updateSelection(next, current) {

                    var activeElement = element.find('.active');

                    var selectedElement = element.find('li > a[href|="#' + $location.path() + '"]').parent();

                    if (selectedElement.length <= 0 && matchSub === true) {
                        var path = $location.path();
                        var slashIndex = path.lastIndexOf("/");
                        while (slashIndex > 0 && selectedElement.length <= 0) {
                            path = path.substring(0, slashIndex);
                            selectedElement = element.find('li > a[href|="#' + path + '"]').parent();
                            slashIndex = path.lastIndexOf("/");
                        }
                    }
                    activeElement.removeClass('active');

                    selectedElement.addClass('active');

                };

                scope.$on('$routeChangeSuccess', updateSelection);

                updateSelection();
            };
        }])
        .directive('agContent', ['$otherwise', function ($otherwise) {
            return {
                link: function (scope, element, attrs) {
                    var otherwiseKey = element.attr('otherwiseKey') || '';
                    scope.$watch(attrs.agContent, function (content) {
                        if (content) {
                            element.html(content);
                        } else if (otherwiseKey !== '') {
                            element.html($otherwise.get(otherwiseKey));
                        }
                    });
                }
            };
        }])
        .directive('agClick', ['$parse', function ($parse) {
            return {
                compile: function ($element, attr) {
                    var fn = $parse(attr.agClick);
                    return function (scope, element, attr) {
                        element.on('click', function (event) {
                            scope.$apply(function () {
                                fn(scope, {$event: event});
                                event.preventDefault();
                                event.stopPropagation();
                            });
                        });
                    };
                }
            };
        }])
        .directive('agDate', ['$otherwise', '$filter', function ($otherwise, $filter) {
            return {
                link: function (scope, element, attrs) {
                    var otherwiseKey = element.attr('otherwiseKey') || '';
                    scope.$watch(attrs.agDate, function (value) {
                        if (value) {
                            element.html($filter('date')(value, 'd MMMM yyyy h:mm a'));
                        } else if (otherwiseKey !== '') {
                            element.html($otherwise.get(otherwiseKey));
                        }
                    });
                }
            };
        }])
        .directive('agKeynav', function () {
            return function (scope, element, attr) {
                var pageSize = attr.agPagesize || 5;
                element.on('keydown', navigate);
                function navigate($event) {
                    var list = scope.$eval(attr.agKeynav);
                    var eventInfo = {steps: 0, first: false, last: false};
                    if ($event.keyCode === 33) {
                        eventInfo.steps = -pageSize;
                    } else if ($event.keyCode === 34) {
                        eventInfo.steps = pageSize;
                    } else if ($event.keyCode === 35) {
                        eventInfo.last = true;
                    } else if ($event.keyCode === 36) {
                        eventInfo.first = true;
                    } else if ($event.keyCode === 40) {
                        eventInfo.steps = 1;
                    } else if ($event.keyCode === 38) {
                        eventInfo.steps = -1;
                    } else {
                        return;
                    }
                    if (list.length <= 0) return;

                    $event.preventDefault();
                    $event.stopPropagation();

                    var elem = element.find(".select-list");
                    var activeIndex = elem.find(".active").index();
                    var targetIndex = -1;
                    if (activeIndex === -1) {
                        targetIndex = 0;
                    } else {
                        if (eventInfo.first)
                            targetIndex = 0;
                        else if (eventInfo.last)
                            targetIndex = list.length - 1;
                        else {
                            targetIndex = activeIndex + eventInfo.steps;
                        }

                        if (targetIndex <= 0) targetIndex = 0;
                        else if (targetIndex >= list.length) targetIndex = list.length - 1;
                    }

                    if (activeIndex === targetIndex) return;
                    var targetElement = elem.children().eq(targetIndex).children().eq(0);

                    if (targetIndex === 0) {
                        elem.scrollTop(0);
                    } else if (targetIndex === list.length - 1) {
                        elem.scrollTop(elem[0].scrollHeight);
                    } else {

                        var elementTop = targetElement.offset().top;
                        var minTop = elem.offset().top;
                        var maxTop = minTop + elem.height() - targetElement.height();
                        if (!(elementTop > minTop && elementTop < maxTop))
                            targetElement[0].scrollIntoView();
                    }
                    scope.$apply(function () {
                        list[targetIndex].selected = true;
                    });
                };
            };
        })
        .directive('agFocus', ['$timeout', function ($timeout) {
            return {
                link: function (scope, element, attrs) {
                    $timeout(function () {
                        element.focus();
                    }, 500);
                }
            };
        }])
        .directive('agLoading', ['connectionInterceptor', function (connectionInterceptor/*, $http*/) {
            return function (scope, element, attrs) {
                var pending = [], connectError = false;
                var connListener = {
                    id: 'agLoading',
                    onRequest: function (config) {
                        pending.push({});
                        if (connectError === false)
                            element.find('.loading').css('display', 'block');
                    },
                    onResponse: function (response) {
                        //console.log($http.pendingRequests.length);
                        if (connectError === true) {
                            connectError = false;
                            element.find('.con-error').css('display', 'none');
                        }
                        pending.pop();
                        if (pending.length === 0)
                            element.find('.loading').css('display', 'none');
                    },
                    onRequestError: function (rejection) {
                        this.onError();
                    },
                    onResponseError: function (rejection) {
                        this.onError();
                        if (rejection.status === 0) {
                            element.find('.con-error').css('display', 'block');
                            connectError = true;
                        }
                    },
                    onError: function (rejection) {
                        pending = [];
                        element.find('.loading').css('display', 'none');
                    }
                };
                connectionInterceptor.addListener(connListener);
            };
        }])
        //ag-attachment
        .directive('agAttachment', ["attachmentIcons", function (attachmentIcons) {
            return function (scope, element, attr) {
                scope.$watch(attr.agAttachment, function (attachment) {
                    if (attachment) {
                        var classes = '', href = '';
                        if (attachment.externalUrl) {
                            classes = 'glyphicon glyphicon-share-alt';
                            href = attachment.externalUrl;
                        } else {
                            if (attachment.type) {
                                if (attachmentIcons[attachment.type]) {
                                    classes = attachmentIcons[attachment.type];
                                } else if (attachment.type.substr(0, 5) === 'image') {
                                    classes = attachmentIcons.image;
                                } else if (attachment.type.indexOf('compressed') != -1) {
                                    classes = attachmentIcons.compressed;
                                }
                            }
                            if (classes === undefined || classes === '')
                                classes = 'fa fa-file';
                            href = attachment.contentUrl + '/' + encodeURI(attachment.name);
                        }
                        element.attr('href', href);
                        element.html('<i class="' + classes + '"></i> <span>' + attachment.name + '</span>');
                    }
                });
            };
        }])
        .directive('agAgo', ['$interval', '$otherwise', '$filter',
            function ($interval, $otherwise, $filter) {
                return function (scope, element, attrs) {
                    var stopTime = undefined,
                        otherwiseKey = element.attr('otherwiseKey') || '',
                        translateKey = element.attr('translateKey') || '',
                        dateValue;

                    function updateTime() {
                        if (dateValue)
                            updateElement(moment(new Date(dateValue)).fromNow());
                    }

                    function updateElement(text) {
                        if (translateKey !== '') {
                            element.text($otherwise.get(translateKey, {ago: text}));
                        } else {
                            element.text(text);
                        }

                    }

                    scope.$watch(attrs.agAgo, function (value) {
                        if (value) {
                            dateValue = value;
                            updateTime();
                            element.attr('title', $filter('date')(value, 'd MMMM yyyy h:mm a'));

                            // start a timer if none was started
                            if (!stopTime)
                                stopTime = $interval(updateTime, 30000);

                        } else {
                            // stop the timer if one was started
                            if (stopTime)
                                $interval.cancel(stopTime);

                            if (otherwiseKey !== '') {
                                var otherwiseVal = $otherwise.get(otherwiseKey);
                                element.text(otherwiseVal);
                                element.attr('title', otherwiseVal);
                            }
                        }
                    });

                    // stop the timer if one was started
                    element.on('$destroy', function () {
                        if (stopTime)
                            $interval.cancel(stopTime);
                    });
                };
            }])
        .filter('variable', ['$filter', function ($filter) {
            return function (value, type) {
                if (type === 'date')
                    return $filter('date')(value, 'd MMMM yyyy h:mm a');

                return value;
            };
        }])
        .run(["$templateCache", "$rootScope", "$translate", "$route", function ($templateCache, $rootScope, $translate, $route) {
            function checkLocaleCss() {
                var css = $translate.instant('CSS');
                if ('CSS' !== css) {
                    document.getElementById("localeCss").innerHTML = css;
                } else {
                    document.getElementById("localeCss").innerHTML = '';
                }
            }

            //checkLocaleCss();

            function updateTitle() {
                var title = '';
                if ($route.current && $route.current.title)
                    title = $route.current.title;
                else
                    return;
                $translate('PAGE_TITLE', {page: 'MENU_' + title}).then(function (translation) {
                    document.title = translation;
                });
            };
            $rootScope.$on("$translateChangeSuccess", handleLocaleChange);
            $rootScope.$on("$routeChangeSuccess", function (event, currentRoute, previousRoute) {
                updateTitle(currentRoute.title);
            });

            function handleLocaleChange() {
                checkLocaleCss();
                updateTitle();
            }
        }])
        .run(["$ui", "$form", function ($ui, $form) {
            $ui.registerModal('showStartForm', function (processDefinition, options, noForm, success, fail) {
                $form.handleStartForm(processDefinition.id, options, noForm, success, fail);
            });
            $ui.registerModal('showTaskForm', function (task, options, noForm, success, fail) {
                $form.handleTaskForm(task.id, options, noForm, success, fail);
            });
        }]);

})();

(function () {
    'use strict';

    angular.module('agTask', [])
        .factory('$taskCache', ['$cacheFactory', function ($cacheFactory) {
            return $cacheFactory('task-cache');
        }])
        .factory('$historicTaskCache', ['$cacheFactory', function ($cacheFactory) {
            return $cacheFactory('historic-task-cache');
        }])
        .factory('Tasks', ['RuntimeRestangular', '$taskCache', 'Task', function (RuntimeRestangular, $taskCache, Task) {
            return RuntimeRestangular.withConfig(function (RestangularConfigurer) {
                RestangularConfigurer.extendModel('tasks', function (task) {
                    if (task.fromServer === false) return task;
                    var cachedTask = $taskCache.get(task.id);
                    if (cachedTask) {
                        cachedTask.updateFromServer(task);
                        return cachedTask;
                    } else {
                        angular.extend(task, Task);
                        task.updateFromServer();
                        $taskCache.put(task.id, task);
                        return task;
                    }

                });
            }).service('tasks');
        }])
        .factory('HistoryTasks', ["HistoryRestangular", "$historicTaskCache", "HistoricTask", function (HistoryRestangular, $historicTaskCache, HistoricTask) {
            return HistoryRestangular.withConfig(function (RestangularConfigurer) {
                RestangularConfigurer.extendModel('historic-task-instances', function (historicTask) {
                    var cachedHistoricTask = $historicTaskCache.get(historicTask.id);
                    if (cachedHistoricTask) {
                        angular.extend(cachedHistoricTask, historicTask);
                        return cachedHistoricTask;
                    }
                    $historicTaskCache.put(historicTask.id, historicTask);
                    return angular.extend(historicTask, HistoricTask);
                });
            }).service('historic-task-instances');
        }])
        .factory('TaskPage', ['$ui', function ($ui) {
            function completeTask(task, data, success, fail) {
                task.complete(data, success, fail);
            };
            function showTaskNotification(task, type, key) {
                $ui.showNotification({
                    type: type,
                    translateKey: key,
                    translateValues: {taskId: task.id, name: task.name}
                });
            }

            function removeTask(page, taskId) {
                page.back(true);
                page.cache.remove(taskId);
            };
            return {
                editTask: function (task) {
                    $ui.showEditTask(task,
                        function (taskUpdate) {
                            task.update(taskUpdate);
                        });
                },

                deleteTask: function (task) {
                    var me = this;
                    $ui.showConfirmation('CONFIRM_DELETE_TASK', {id: task.id, name: task.name}, function () {
                            task.remove().then(
                                function () {
                                    removeTask(me, task.id);
                                    showTaskNotification(task, 'info', 'NOT_TASK_DELETE_OK');
                                },
                                function (response) {
                                    //TODO handle error response
                                    me.back(true);
                                    showTaskNotification(task, 'danger', 'NOT_TASK_DELETE_FAIL');
                                }
                            );
                        }
                    );

                },
                postComment: function (task) {
                    $ui.showPostComment(task);
                },

                complete: function (task) {
                    var me = this;
                    if (task.taskDefinitionKey) {
                        $ui.showTaskForm(task, {}, function () {
                            completeTask(task, undefined, function (result) {
                                    removeTask(me, task.id);
                                    showTaskNotification(task, 'info', 'NOT_TASK_COMPLETE_OK');
                                },
                                function (response) {
                                    me.back(true);
                                    showTaskNotification(task, 'danger', 'NOT_TASK_COMPLETE_FAIL');
                                });
                        }, function (result) {
                            removeTask(me, task.id);
                            showTaskNotification(task, 'info', 'NOT_TASK_COMPLETE_OK');
                        });
                    } else {
                        completeTask(task, undefined, function () {
                                removeTask(me, task.id);
                                showTaskNotification(task, 'info', 'NOT_TASK_COMPLETE_OK');
                            },
                            function (response) {
                                me.back(true);
                                showTaskNotification(task, 'danger', 'NOT_TASK_COMPLETE_FAIL');
                            });

                    }
                },

                claim: function (task) {
                    var me = this;
                    task.claim(
                        function () {
                            me.back(true);
                            showTaskNotification(task, 'info', 'NOT_TASK_CLAIM_OK');
                        },
                        function (response) {
                            me.back(true);
                            showTaskNotification(task, 'danger', 'NOT_TASK_CLAIM_FAIL');
                        }
                    );
                },
                showAddVar: function (task) {
                    $ui.showAddVar(task);
                },

                showEditVar: function (task, variable) {
                    $ui.showEditVar(task, variable);
                }

            };

        }])
        .service('$taskService', ['Tasks', function (Tasks) {
            this.createTask = function (task) {
                return Tasks.post(task);
            };
            this.createSubTask = function (parentTask, subtask, success, failed) {
                return parentTask.createSubTask(subtask, success, failed);
            };
        }])
        .service('$taskPage', ['Session', 'ListPage', 'Tasks', '$taskCache', 'TaskPage', '$historicTaskCache', 'HistoryTasks',
            function (Session, ListPage, Tasks, $taskCache, TaskPage, $historicTaskCache, HistoryTasks) {
                var inboxPage = createTaskListPage('inbox', 'assignee'), myTasksPage = createTaskListPage('mytasks', 'owner'),
                    involvedPage = createTaskListPage('involved', 'involvedUser'), queuedPage = createTaskListPage('queued', 'candidateUser'),
                    archivedPage = createHistoricTaskListPage('archived', 'taskInvolvedUser');

                function createTaskListPage(section, param) {
                    var listPage = {
                        template: 'core/view/listPage.html',
                        listControlsTemplate: 'task/view/listControls.html',
                        listTemplate: 'task/view/list.html',
                        itemControlsTemplate: 'task/view/itemControls.html',
                        itemTemplate: 'task/view/item.html',
                        section: section,
                        itemName: 'task',
                        sortKeys: {id: 'id', priority: 'priority', dueDate: 'dueDate', createTime: 'createTime'},
                        requestParam: {start: 0, order: 'desc', sort: 'id'},
                        listSize: 10,
                        queryResource: Tasks,
                        cache: $taskCache
                    };
                    listPage.requestParam[param] = Session.getUserId();
                    listPage = angular.extend(listPage, ListPage);
                    /*listPage.queryOne = function(taskId, success, fail){
                     var requestParams = angular.extend({taskId: taskId}, this.requestParams);
                     return this.queryList(requestParams,function(tasks){
                     if(tasks.length===0){
                     fail();
                     }else{
                     success(tasks[0]);
                     }
                     },fail);
                     };*/
                    return angular.extend(listPage, TaskPage);

                };

                function createHistoricTaskListPage(section, param) {
                    var listPage = {
                        template: 'core/view/listPage.html',
                        listControlsTemplate: 'task/view/listControls.html',
                        listTemplate: 'task/view/list.html',
                        itemControlsTemplate: 'task/view/itemControls.html',
                        itemTemplate: 'task/view/item.html',
                        section: section,
                        itemName: 'task',
                        sortKeys: {
                            taskInstanceId: 'id',
                            priority: 'priority',
                            dueDate: 'dueDate',
                            startTime: 'startTime',
                            endTime: 'endTime'
                        },
                        requestParam: {
                            start: 0,
                            order: 'desc',
                            sort: 'taskInstanceId',
                            finished: true,
                            includeTaskLocalVariables: true
                        },
                        listSize: 10,
                        queryResource: HistoryTasks,
                        cache: $historicTaskCache
                    };
                    listPage.requestParam[param] = Session.getUserId();
                    listPage = angular.extend(listPage, ListPage);
                    listPage.getItem = function (taskId) {
                        var task = this.cache.get(taskId);
                        if (task) {
                            if (task.endTime !== null)
                                return task;
                            this.cache.remove(taskId);
                        }
                    };
                    listPage.queryOne = function (taskId, success, fail) {
                        var requestParams = angular.extend({taskId: taskId}, this.requestParam);
                        requestParams.start = 0;
                        return this.queryList(requestParams, function (tasks) {
                            if (tasks.length === 0) {
                                fail();
                            } else {
                                success(tasks[0]);
                            }
                        }, fail);
                    };
                    return listPage;

                };

                this.getInboxPage = function (taskId) {
                    return inboxPage.show(taskId);
                };

                this.getMyTasksPage = function (taskId) {
                    return myTasksPage.show(taskId);
                };

                this.getInvolvedPage = function (taskId) {
                    return involvedPage.show(taskId);
                };

                this.getQueuedPage = function (taskId) {
                    return queuedPage.show(taskId);
                };

                this.getArchivedPage = function (taskId) {
                    return archivedPage.show(taskId);
                };

            }])
        .factory('CreateEditTaskHandler', ["$taskService", "$ui", function ($taskService, $ui) {
            return {
                handle: function (scope, modal, options) {
                    var task = {};
                    if (options.op === 'NEW') {
                        task.owner = scope.currentUser.id;
                        task.priority = 50;
                        if (options.parentTask) {
                            task.parentTaskId = options.parentTask.id;
                            scope.title = 'NEW_SUB_TASK';
                        } else {
                            scope.title = 'NEW_TASK';
                        }
                    } else {
                        task.name = options.task.name;
                        task.description = options.task.description;
                        task.priority = options.task.priority;
                        task.dueDate = options.task.dueDate;
                        task.category = options.task.category;
                        scope.title = 'EDIT_TASK';
                    }

                    scope.showErrors = false;
                    scope.task = task;

                    scope.submitForm = function (isValid) {
                        // check to make sure the form is completely valid
                        if (isValid) {
                            /*modal.close(scope.task);*/
                            /*if(options.task){
                             options.task.update($scope.task);
                             modal.close();
                             return;
                             }else if(options.parentTask){
                             options.parentTask.createSubTask(scope.task, success, failed);
                             }*/
                            $taskService.createTask(scope.task).then(
                                function (newTask) {
                                    modal.close();
                                    $ui.showNotification({
                                        type: 'info',
                                        translateKey: 'NOT_TASK_CREATE_OK',
                                        translateValues: {taskId: newTask.id, name: newTask.name}
                                    });
                                },
                                function () {
                                    $ui.showNotification({type: 'danger', translateKey: 'NOT_TASK_CREATE_FAIL'});
                                });
                        } else {
                            scope.showErrors = true;
                        }
                    };

                }
            };
        }])
        .controller('CreateEditTaskModalInstanceCtrl', ["$scope", "$uibModalInstance", "options", function ($scope, $uibModalInstance, options) {
            var task = {};
            if (options.op === 'NEW') {
                task.owner = $scope.currentUser.id;
                task.priority = 50;
                if (options.parentTask) {
                    task.parentTaskId = options.parentTask.id;
                    $scope.title = 'NEW_SUB_TASK';
                } else {
                    $scope.title = 'NEW_TASK';
                }
            } else {
                task.name = options.task.name;
                task.description = options.task.description;
                task.priority = options.task.priority;
                task.dueDate = options.task.dueDate;
                task.category = options.task.category;
                $scope.title = 'EDIT_TASK';
            }

            $scope.showErrors = false;
            $scope.task = task;

            $scope.submitForm = function (isValid) {
                // check to make sure the form is completely valid
                if (isValid) {
                    $uibModalInstance.close($scope.task);
                } else {
                    $scope.showErrors = true;
                }
            };

            $scope.cancel = function () {
                $uibModalInstance.dismiss('cancel');
            };

        }])
        .controller('TaskAttachmentController', ['$scope', '$upload', '$uibModalInstance', 'options', function ($scope, $upload, $modalInstance, options) {
            $scope.attachmentType = 'URL';
            $scope.title = options.title;
            $scope.showErrors = false;
            $scope.data = {externalUrl: '', name: '', description: ''};
            $scope.submitForm = function (attachmentType, isValid) {
                // check to make sure the form is completely valid
                if (!isValid) {
                    $scope.showErrors = true;
                    return;
                }

                if (attachmentType === 'File') {
                    if ($scope.selectedFile) {
                        $scope.data.type = $scope.selectedFile.type; // set content type
                        $scope.uploadFile($scope.selectedFile, $scope.data);
                        $scope.uploadProgress = 0;
                        $scope.uploading = true;
                    } else {
                        $scope.showErrors = true;
                        return;
                    }
                } else if (attachmentType === 'URL') {
                    options.task.post('attachments', $scope.data);
                    $modalInstance.close();
                }
            };

            $scope.cancel = function () {
                $modalInstance.dismiss('cancel');
            };

            $scope.onFileSelect = function ($file) {
                $scope.selectedFile = $file[0];
                $scope.data.name = $file[0].name;
                //TODO set max file size allowed
                //if(5242880 < $file[0].size)
                //	console.log($file[0].size);

            };
            $scope.uploadFile = function (file, data) {
                $scope.upload = $upload.upload({
                    url: options.url,
                    data: data,
                    file: file
                }).progress(function (evt) {
                    $scope.uploadProgress = parseInt(100.0 * evt.loaded / evt.total);
                }).success(function (data, status, headers, config) {
                    $modalInstance.close();
                });
            };
        }])
        .controller('TaskTabsCtrl', ["$scope", "$ui", function ($scope, $ui) {

            $scope.deleteIdentityLink = function (task, identityLink) {
                var canDelete = (task.owner || task.assignee || task.identityLinks.length > 1);

                if (canDelete === false) {
                    // Task should have at least have one identitylink
                    $ui.showNotification({type: 'warning', translateKey: 'TASK_MIN_INVOLVEMENT'});
                    return;
                }

                $ui.showConfirmation((identityLink.user) ? 'CONFIRM_DeleteUserLink' : 'CONFIRM_DeleteGroupLink', identityLink, function () {
                        task.deleteIdentityLink(identityLink);
                    }
                );
            };
            $scope.editIdentityLink = function (task, type) {
                $ui.showSelectIdentity('user', 'EDIT_TASK_ROLE_' + type, function (identityLink) {
                    identityLink.type = type;
                    task.addIdentityLink(identityLink);
                });
            };

            $scope.addIdentityLink = function (task) {
                $ui.showAddIdentityLink(undefined, ['involved', 'candidate'], 'INVOLVE_TO_TASK', function (identityLink) {
                    task.addIdentityLink(identityLink);
                });
            };

            $scope.attach = function (task) {

                $ui.showAddTaskAttachment(task,
                    function (result) {
                        task.refreshAttachments(true);
                        task.refreshEvents(true);
                    });
            };

            $scope.deleteAttachment = function (task, attachment) {
                $ui.showConfirmation('CONFIRM_DeleteAttachment', {name: attachment.name}, function () {
                    attachment.remove();
                    task.refreshAttachments(true);
                    task.refreshEvents(true);
                });
            };
            $scope.newSubTask = function (task) {
                $ui.showCreateSubTask(task);
            };
        }])
        .factory('Task', ['Session', function (Session) {
            return {
                updateFromServer: function (update) {
                    if (update) {
                        delete update.variables;
                        angular.extend(this, update);
                    } else {
                        delete this.variables;
                    }
                    //updateVariables(this, this.variables);
                },
                refresh: function (options, success) {
                    var me = this;
                    this.get().then(
                        function (task) {
                            angular.extend(me, task);
                            me.refreshVariables(true);

                            if (me.identityLinks)
                                me.refreshIdentityLinks(true);

                            if (me.attachments)
                                me.refreshAttachments(true);

                            if (me.subTasks)
                                me.refreshSubTasks(true);

                            if (me.events)
                                me.refreshEvents(true);
                        }
                    );
                },
                refreshIdentityLinks: function (forceRefresh, success, failed) {
                    if (!forceRefresh && this.identityLinks) return;
                    var me = this;
                    this.getList("identitylinks").then(
                        function (identityLinks) {
                            var filteredIdentityLinks = [], owner = null, assignee = null, isCandidate = false, isInvolved = false;
                            var user = Session.getUser();
                            for (var i = 0, l = identityLinks.length; i < l; i++) {
                                if (identityLinks[i].user) {
                                    if (identityLinks[i].type === 'owner')
                                        owner = identityLinks[i].user;
                                    else if (identityLinks[i].type === 'assignee')
                                        assignee = identityLinks[i].user;
                                    else {
                                        filteredIdentityLinks.push(identityLinks[i]);
                                        if (user.id === identityLinks[i].user) {
                                            if (identityLinks[i].type === 'candidate') isCandidate = true;
                                            else isInvolved = true;
                                        }

                                    }
                                } else {
                                    filteredIdentityLinks.push(identityLinks[i]);
                                    if (user.groups[identityLinks[i].group] &&
                                        identityLinks[i].type === 'candidate') isCandidate = true;
                                }
                            }
                            me.owner = owner;
                            me.assignee = assignee;
                            if (me.assignee) {
                                if (user.id === me.assignee) me.isAssignee = true;
                                else me.isAssignee = false;
                            } else me.isAssignee = false;

                            if (me.owner) {
                                if (user.id === me.owner) me.isOwner = true;
                                else me.isOwner = false;
                            } else me.isOwner = false;

                            me.isCandidate = isCandidate;
                            me.isInvolved = isInvolved;

                            me.identityLinks = filteredIdentityLinks;
                            if (success)success();
                        },
                        function (response) {
                            if (failed)failed(response);
                        }
                    );
                },
                refreshAttachments: function (forceRefresh, success, failed) {
                    if (!forceRefresh && this.attachments) return;
                    var me = this;
                    this.getList("attachments").then(function (attachments) {
                        me.attachments = attachments;
                    });
                },
                refreshEvents: function (forceRefresh, success, failed) {
                    if (!forceRefresh && this.events) return;
                    var me = this;
                    this.getList("events").then(function (events) {
                        me.events = events;
                    });
                },
                refreshSubTasks: function (forceRefresh, success, failed) {
                    if (!forceRefresh && this.subTasks) return;
                    var me = this;
                    this.getList('subtasks').then(
                        function (subTasks) {
                            me.subTasks = subTasks;
                        }
                    );
                },
                update: function (update) {
                    var taskUpdate = {};
                    var updated = false;
                    for (var key in update) {
                        if (this[key] !== update[key]) {
                            taskUpdate[key] = update[key];
                            updated = true;
                        }
                    }
                    if (updated === false) return;

                    var me = this;
                    this.customPUT(taskUpdate).then(
                        function (updatedTask) {
                            angular.extend(me, updatedTask);
                        });
                },
                refreshVariables: function (forceRefresh, success, failed) {
                    if (!forceRefresh && this.variables) return;
                    var me = this;
                    this.getList("variables", {scope: 'local'}).then(function (variables) {
                        me.variables = variables;
                    });
                },

                addVariable: function (variable, success, failed) {
                    var me = this;
                    variable.scope = 'local';
                    var variableArr = [variable];
                    this.customPOST(variableArr, "variables").then(function (variables) {
                        me.refreshVariables(true);
                    });
                },

                editVariable: function (variable, variableUpdate, success, failed) {
                    var me = this;
                    variable.scope = 'local';
                    variable.customPUT(variableUpdate, variable.name).then(function (updatedVariable) {
                        me.refreshVariables(true);
                    });
                },

                deleteVariable: function (variable, success, failed) {
                    var me = this;
                    variable.customDELETE(variable.name).then(function () {
                        me.refreshVariables(true);
                    });
                },

                addIdentityLink: function (identityLink, success, failed) {
                    var me = this;
                    this.post("identitylinks", identityLink, "identitylinks").then(function () {
                        me.refreshIdentityLinks(true);
                        if (me.events)
                            me.refreshEvents(true);
                    });
                },

                deleteIdentityLink: function (identityLink, success, failed) {
                    var me = this;
                    var link = (identityLink.group) ? 'groups/' + identityLink.group : 'users/' + identityLink.user;
                    this.customDELETE('identitylinks/' + link + '/' + identityLink.type).then(function () {
                        me.refreshIdentityLinks(true);
                        if (me.events)
                            me.refreshEvents(true);
                    });
                },

                addComment: function (comment, success, failed) {
                    var me = this;
                    this.post('comments', {message: comment}).then(
                        function () {
                            me.refreshEvents(true);
                        }
                    );
                },
                createSubTask: function (subTask, success, failed) {
                    var me = this;
                    this.customPOST(subTask, '../../tasks').then(
                        function (newSubtask) {
                            me.refreshSubTasks(true);
                            if (success) success(newSubtask);
                        }, failed
                    );
                },
                claim: function (success, failed) {
                    var me = this;
                    this.customPOST({action: 'claim', assignee: Session.getUserId()}).then(function () {
                        if (success) success();
                        me.refreshIdentityLinks(true);
                    }, failed);
                },
                complete: function (data, success, failed) {
                    var params = {action: 'complete'};
                    if (data) {
                        data.action = 'complete';
                        params = data;
                    }
                    this.customPOST(params).then(success, failed);
                }
            };
        }])
        .factory('HistoricTask', function () {
            return {
                refresh: function (options, success) {
                    var me = this;
                    this.get().then(
                        function (task) {
                            angular.extend(me, task);
                            //me.refreshVariables();

                            if (me.identityLinks)
                                me.refreshIdentityLinks();

                            if (me.attachments)
                                me.refreshAttachments();

                            if (me.subTasks)
                                me.refreshSubTasks();

                            if (me.events)
                                me.refreshEvents();
                        }
                    );
                },
                refreshIdentityLinks: function (forceRefresh, success, failed) {
                    if (!forceRefresh && this.identityLinks) return;
                    var me = this;
                    this.getList("identitylinks").then(
                        function (identityLinks) {
                            var filteredIdentityLinks = [];
                            for (var i = 0, l = identityLinks.length; i < l; i++) {
                                if (identityLinks[i].type !== 'owner' && identityLinks[i].type !== 'assignee')
                                    filteredIdentityLinks.push(identityLinks[i]);
                            }

                            me.identityLinks = filteredIdentityLinks;
                            if (success)success();
                        },
                        function (response) {
                            if (failed)failed(response);
                        }
                    );
                },
                refreshAttachments: function (forceRefresh, success, failed) {
                    if (!forceRefresh && this.attachments) return;
                    var me = this;
                    this.getList("../../../runtime/tasks/" + this.id + "/attachments").then(function (attachments) {
                        me.attachments = attachments;
                    });
                },
                refreshEvents: function (forceRefresh, success, failed) {
                    if (!forceRefresh && this.events) return;
                    var me = this;
                    this.getList("../../../runtime/tasks/" + this.id + "/events").then(function (events) {
                        me.events = events;
                    });
                },
                refreshSubTasks: function (forceRefresh, success, failed) {
                    if (!forceRefresh && this.subTasks) return;
                    var me = this;
                    this.getList("../../historic-task-instances", {parentTaskId: this.id}).then(
                        function (subTasks) {
                            me.subTasks = subTasks;
                        }
                    );
                }/*,
                 refreshVariables : function (options, success, failed){
                 if(this.taskVariables) return;
                 var me = this;
                 this.getList("..",{taskId: this.id, includeTaskLocalVariables: true}).then(function (data){
                 me.taskVariables = data[0].variables;
                 //me.taskVariables = variables;
                 });
                 }*/
            };
        })
        .filter('taskPriority', function () {
            return function (input) {
                input = input || 0;
                if (input < 50)
                    return "LOW_PRIORITY";
                if (input > 50)
                    return "HIGH_PRIORITY";
                return "NORMAL_PRIORITY";
            };
        })
        .run(['$taskService', 'Session', '$ui', function ($taskService, Session, $ui) {
            $ui.registerModal('showCreateTask', function (onOK, onCancel) {
                this.showModal('core/view/createTask.html', 'AgModalController', {
                    options: function () {
                        return {op: 'NEW', handler: 'CreateEditTaskHandler'};
                    }
                }, function (task) {
                    /*$taskService.createTask(task).then(
                     function(newTask){
                     $ui.showNotification({type: 'info', translateKey: 'NOT_TASK_CREATE_OK', translateValues :{taskId: newTask.id, name: newTask.name}});
                     },
                     function(){
                     $ui.showNotification({type: 'danger', translateKey: 'NOT_TASK_CREATE_FAIL'});
                     });*/

                }, onCancel);
            });
            $ui.registerModal('showEditTask', function (task, onOK, onCancel) {
                this.showModal('core/view/createTask.html', 'CreateEditTaskModalInstanceCtrl', {
                    options: function () {
                        return {task: task, op: 'EDIT'};
                    }
                }, function (update) {
                    task.update(update);
                }, onCancel);
            });

            $ui.registerModal('showCreateSubTask', function (parentTask, onOK, onCancel) {
                this.showModal('core/view/createTask.html', 'CreateEditTaskModalInstanceCtrl', {
                    options: function () {
                        return {op: 'NEW', parentTask: parentTask};
                    }
                }, function (task) {
                    $taskService.createSubTask(parentTask, task,
                        function (newTask) {
                            $ui.showNotification({
                                type: 'info',
                                translateKey: 'NOT_TASK_CREATE_OK',
                                translateValues: {taskId: newTask.id, name: newTask.name}
                            });
                        },
                        function () {
                            $ui.showNotification({type: 'danger', translateKey: 'NOT_TASK_CREATE_FAIL'});
                        });

                }, onCancel);
            });

            $ui.registerModal('showAddTaskAttachment', function (task, onOK, onCancel) {
                this.showModal('common/view/addAttachment.html', 'TaskAttachmentController', {
                    options: function () {
                        return {url: task.url + '/attachments', task: task, title: '_ADD_ATTACHMENT'};
                    }
                }, onOK, onCancel);
            });
        }]);

})();

(function () {
    'use strict';

    /* agStorage */

    angular.module('agStorage', ['ngCookies'])
        .factory('$storage', ["$window", "$cookieStore", function ($window, $cookieStore) {
            //from https://github.com/angular-translate/angular-translate/blob/master/src/service/storage-local.js
            var hasLocalStorageSupport = 'localStorage' in $window;
            if (hasLocalStorageSupport) {
                var testKey = 'agStorageTest';
                try {
                    // this check have to be wrapped within a try/catch because on
                    // a SecurityError: Dom Exception 18 on iOS
                    if ($window.localStorage !== null) {
                        $window.localStorage.setItem(testKey, 'foo');
                        $window.localStorage.removeItem(testKey);
                        hasLocalStorageSupport = true;
                    } else {
                        hasLocalStorageSupport = false;
                    }
                } catch (e) {
                    hasLocalStorageSupport = false;
                }
            }

            if (hasLocalStorageSupport) {
                return {
                    get: function (key) {
                        return $window.localStorage.getItem(key);
                    },
                    set: function (key, value) {
                        $window.localStorage.setItem(key, value);
                    },
                    remove: function (key) {
                        $window.localStorage.removeItem(key);
                    },
                    isLocalStorage: true
                };
            } else {
                return {
                    get: function (key) {
                        return $cookieStore.get(key);
                    },
                    set: function (key, value) {
                        $cookieStore.put(key, value);
                    },
                    remove: function (key) {
                        $cookieStore.remove(key);
                    },
                    isLocalStorage: false
                };
            }
        }]);
})();

(function () {
    'use strict';

    angular.module('act-page', [])
        .factory('ListPage', ['$q', '$location', function ($q, $location) {
            return {
                from: 0,
                to: 0,
                total: 0,
                hasPrevious: false,
                hasNext: false,
                previous: function (options) {
                    if (this.hasPrevious === true) {
                        this.requestParam.start = this.requestParam.start - this.listSize;
                        if (this.requestParam.start < 0)
                            this.requestParam.start = 0;
                        this.refresh(true);
                    }
                },
                next: function (options) {
                    if (this.hasNext === true) {
                        this.requestParam.start = this.requestParam.start + this.listSize;
                        this.refresh(true);
                    }
                },
                refresh: function (navigated, success, fail) {
                    var me = this;
                    this.queryList(this.requestParam,
                        function (data) {
                            //if no items in current page navigate back
                            if (data.total > 0 && data.size === 0) {
                                var newStart = (data.total - (data.total % me.listSize));
                                if (newStart === data.total)
                                    newStart = data.total - me.listSize;
                                me.requestParam.start = newStart;
                                me.refresh(navigated, success, fail);
                                return;
                            }
                            me.list = data;
                            me.total = data.total;
                            me.from = me.requestParam.start + 1;
                            me.to = me.requestParam.start + me.listSize;
                            me.hasPrevious = me.requestParam.start > 0;
                            me.hasNext = ((me.requestParam.start + me.listSize) < me.total);

                            if (me.sortKeys)
                                me.sortKey = me.sortKeys[me.requestParam.sort] || me.requestParam.sort;
                            if (success)
                                success(data);
                            if (navigated)
                                me.scollList();
                        },
                        function (response) {
                            if (fail)
                                fail(response);
                        }
                    );
                },
                sortBy: function (paramId) {
                    this.requestParam.sort = paramId;

                    this.requestParam.start = 0;
                    this.refresh(true);
                },
                toggleOrder: function () {
                    if (this.requestParam.order === 'asc') this.requestParam.order = 'desc';
                    else this.requestParam.order = 'asc';
                    this.requestParam.start = 0;
                    this.refresh(true);
                },
                scollList: function () {
                    var listElm = document.getElementById('list');
                    if (listElm)
                        listElm.scrollTop = 0;
                },
                show: function (itemId) {
                    if (itemId) {
                        return this.showItem(itemId);
                    } else {
                        return this.showList();
                    }
                },
                showItem: function (itemId) {
                    var item = this.getItem(itemId);
                    if (item) {
                        this[this.itemName] = item;
                        this.controlsTemplate = this.itemControlsTemplate;
                        this.showingItem = true;
                        return this;
                    }
                    var deferred = $q.defer();
                    var me = this;

                    this.queryOne(itemId, function (item) {
                        me[me.itemName] = item;
                        me.controlsTemplate = me.itemControlsTemplate;
                        me.showingItem = true;
                        deferred.resolve(me);
                    }, function (response) {
                        deferred.reject();
                        me.back(true);
                    });
                    return deferred.promise;
                },
                getItem: function (itemId) {
                    return this.cache.get(itemId);
                },
                queryOne: function (itemId, success, fail) {
                    return this.queryResource.one(itemId).get().then(success, fail);
                },
                queryList: function (requestParam, success, fail) {
                    return this.queryResource.getList(requestParam).then(success, fail);
                },
                showList: function () {
                    if (this.list) {
                        this.controlsTemplate = this.listControlsTemplate;
                        this.showingItem = false;
                        this.refresh();
                        return this;
                    }
                    var deferred = $q.defer();
                    var me = this;
                    this.refresh(false, function () {
                        me.controlsTemplate = me.listControlsTemplate;
                        me.showingItem = false;
                        deferred.resolve(me);
                    });
                    return deferred.promise;
                },
                back: function (replace) {
                    var path = $location.path();
                    $location.path(path.substring(0, path.lastIndexOf("/")));
                    if (replace)
                        $location.replace();
                },
                onPageShow: function () {
                }
            };
        }])
        .directive('agItemPage', ['$templateCache', '$compile', function ($templateCache, $compile) {
            return {
                restrict: 'ECA',
                priority: -400,
                link: function (scope, element, attrs) {
                    function updatePage(page) {
                        if (page && page.showingItem === true && page.itemTemplate) {
                            element.html($templateCache.get(page.itemTemplate));
                            var link = $compile(element.contents());
                            link(scope);
                        }
                    };
                    scope.$watch(attrs.agItemPage, updatePage);

                    scope.$on('pageUpdateStart', function (event, page) {
                        updatePage(page);
                    });
                }
            };
        }])
        .directive('actPage', ['$route', function ($route) {
            return function (scope) {

                function updatePage() {
                    if ($route.current && $route.current.locals) {
                        var page = $route.current.locals.page || {};

                        var previousPage = scope.page, eventType = "pageChange";
                        if (previousPage === page) {
                            eventType = "pageUpdate";
                        }
                        scope.$broadcast(eventType + 'Start', page, previousPage);
                        scope.page = page;
                        scope.$broadcast(eventType + 'Success', page, previousPage);
                    }
                };
                scope.$on('$routeChangeSuccess', updatePage);
                updatePage();
            };
        }])
        .directive('agPageScroll', function () {
            return function (scope, element, attr) {
                scope.$watch(attr.agPageScroll, function (page) {
                    element.scrollTop(0);
                });
            };
        });

})();

(function () {
    'use strict';

    /* agIdentity */


    var DEFAULT_USER_PIC = "resources/Images/user.png",
        DEFAULT_GROUP_PIC = "resources/Images/group.png";

    function setUserPicture(userId, element, $identity) {
        if (userId) {
            $identity.getUser(userId).then(function (user) {
                    if (user.pictureUrl !== null)
                        element.attr("src", user.pictureUrl);
                    else
                        element.attr("src", DEFAULT_USER_PIC);
                },
                function () {
                    element.attr("src", DEFAULT_USER_PIC);
                });
        } else {
            element.attr("src", DEFAULT_USER_PIC);
        }
    };

    angular.module('agIdentity', [])
        .service('$identity', ['$http', '$q', function ($http, $q) {
            var users = {}, groups = {}, roles = {};

            function cacheUser(user) {
                user.identityType = 'user';
                user.name = user.firstName || user.id;
                if (user.lastName)
                    user.name += ' ' + user.lastName;

                users[user.id] = user;
            };
            function cacheGroup(group) {
                if (group.type === 'security-role') {
                    group.identityType = 'role';
                    roles[group.id] = group;
                } else {
                    group.identityType = 'group';
                    groups[group.id] = group;
                }
            };
            this.getUser = function (userId, instant) {
                var user = users[userId];

                var deferred = $q.defer();

                if (user) {
                    deferred.resolve(user);
                } else {
                    $http.get('identity/users/' + userId)
                        .success(function (user) {
                            cacheUser(user);
                            deferred.resolve(user);
                        })
                        .error(function (response) {
                            //create a fake user to avoid future errors
                            var user = {id: userId, firstName: userId, lastName: '', pictureUrl: null};
                            cacheUser(user);
                            deferred.reject(user);
                        });
                }
                return deferred.promise;
            };

            this.getGroup = function (groupId) {
                var group = groups[groupId];

                var deferred = $q.defer();

                if (group) {
                    deferred.resolve(group);
                } else {
                    $http.get('identity/groups/' + groupId)
                        .success(function (group) {
                            cacheGroup(group);
                            deferred.resolve(group);
                        })
                        .error(function (response) {
                            //create a fake group to avoid future errors
                            var group = {id: groupId, name: groupId, type: 'assignment'};
                            cacheGroup(group);
                            deferred.reject(group);
                        });
                }
                return deferred.promise;
            };
            this.boot = function (data) {
                for (var i = 0, l = data.users.length; i < l; i++) {
                    cacheUser(data.users[i]);
                }

                for (var i = 0, l = data.groups.length; i < l; i++) {
                    cacheGroup(data.groups[i]);
                }
            };

            this.getUsers = function () {
                var userArray = [];
                for (var userId in users) {
                    userArray.push(users[userId]);
                }
                return userArray;
            };

            this.getGroups = function () {
                var groupArray = [];
                for (var groupId in groups) {
                    groupArray.push(groups[groupId]);
                }
                return groupArray;
            };

            this.getUserName = function (userId) {
                var user = users[userId];
                if (user) {
                    return user.name;
                } else {
                    this.getUser(userId);
                }
                return userId;
            };

            this.getGroupName = function (groupId) {
                var group = groups[groupId];
                if (group) {
                    return group.name;
                } else {
                    this.getGroup(groupId);
                }
                return groupId;
            };

            this.isRole = function (roleId) {
                return roles[roleId] !== undefined;
            };
        }])
        //Controllers
        .controller('AddIdentityController', ["$scope", "$uibModalInstance", "$identity", "options", function ($scope, $uibModalInstance, $identity, options) {
            var itemList = [];

            if (options.identityType === undefined || options.identityType === 'user')
                itemList = itemList.concat($identity.getUsers());
            if (options.identityType === undefined || options.identityType === 'group')
                itemList = itemList.concat($identity.getGroups());

            for (var i = 0; i < itemList.length; i++) {
                if (angular.isUndefined(itemList[i].selected))
                    itemList[i].selected = false;
            }
            $scope.title = options.title;
            $scope.itemList = itemList;
            $scope.selectedItems = [];
            $scope.filteredList = itemList;
            $scope.types = options.roles;

            $scope.ok = function (isValid, selectedIdentities, identityRole) {
                if (!isValid || selectedIdentities.length <= 0) {
                    $scope.showErrors = true;
                    return;
                }
                var identityLink = {type: identityRole};

                if (selectedIdentities[0].identityType === 'group')
                    identityLink.group = selectedIdentities[0].id;
                else
                    identityLink.user = selectedIdentities[0].id;
                $uibModalInstance.close(identityLink);
            };
            $scope.cancel = function () {
                $uibModalInstance.dismiss('cancel');
            };
        }])
        .controller('SelectIdentityController', ["$scope", "$uibModalInstance", "$identity", "options", function ($scope, $uibModalInstance, $identity, options) {
            var itemList = angular.copy($identity.getUsers());

            for (var i = 0; i < itemList.length; i++) {
                if (angular.isUndefined(itemList[i].selected))
                    itemList[i].selected = false;
            }
            $scope.title = options.title;
            $scope.itemList = itemList;
            $scope.selectedItems = [];
            $scope.filteredList = itemList;
            $scope.types = options.types;

            if (options.removable)
                $scope.removable = true;

            $scope.ok = function (selectedIdentities) {
                if (selectedIdentities.length <= 0) {
                    $scope.showErrors = true;
                    return;
                }
                var identityLink = {};
                if (selectedIdentities[0].identityType === 'group')
                    identityLink.group = selectedIdentities[0].id;
                else
                    identityLink.user = selectedIdentities[0].id;
                $uibModalInstance.close(identityLink);
            };
            $scope.cancel = function () {
                $uibModalInstance.dismiss('cancel');
            };
        }])
        .controller('UserProfileController', ["$scope", "$http", "$upload", "$ui", 'serviceUrl', function ($scope, $http, $upload, $ui, serviceUrl) {
            function getChanges() {
                var changes = {}, update = $scope.userProfile;
                var updated = false;
                for (var key in update) {
                    if ($scope.currentUser[key] !== update[key]) {
                        changes[key] = update[key];
                        updated = true;
                    }
                }
                if (updated === false) return false;
                return changes;
            };

            function updateUser(user, updatePic) {
                user.name = user.firstName || user.id;
                if (user.lastName)
                    user.name += ' ' + user.lastName;
                if (updatePic) {
                    updatePicture(user);
                } else {
                    delete user.pictureUrl;
                }
                angular.extend($scope.currentUser, user);
                $scope.resetForm();
            };

            function updatePicture(user) {
                user.pictureUrl = user.url + '/picture?x=' + new Date().getTime();
            };

            function uploadPicture(file, data, url) {
                return $upload.upload({
                    url: url,
                    data: data,
                    file: file,
                    method: 'PUT'
                });
            };

            $scope.submitForm = function (isValid) {
                if (isValid) {
                    var changes = getChanges();
                    if (changes) {
                        $http.put(serviceUrl + '/identity/profile', changes).success(function (user) {
                            if ($scope.selectedFile) {
                                uploadPicture($scope.selectedFile, {}, serviceUrl + '/identity/profile/picture').success(function () {
                                    updateUser(user, true);
                                }).error(function (response) {
                                    updateUser(user, false);
                                    // TODO show error
                                });
                            } else {
                                updateUser(user, false);
                            }
                        });
                    } else if ($scope.selectedFile) {
                        uploadPicture($scope.selectedFile, {}, serviceUrl + '/identity/profile/picture').success(function () {
                            updatePicture($scope.currentUser);
                            $scope.resetForm();
                        });
                    }
                }
            };

            $scope.resetForm = function () {
                $scope.userProfile = {
                    firstName: $scope.currentUser.firstName,
                    lastName: $scope.currentUser.lastName,
                    email: $scope.currentUser.email
                };
                delete $scope.selectedFile;
                delete $scope.fileName;
                $scope.invalidImg = false;
            };

            $scope.onPictureSelect = function ($file) {
                if ($file[0].type.match('image.*')) {
                    $scope.selectedFile = $file[0];
                    $scope.fileName = $file[0].name;
                    $scope.invalidImg = false;
                } else {
                    $scope.invalidImg = true;
                }
            };

            $scope.changePassword = function () {
                $ui.showModal('views/changePassword.html', 'ChangePasswordController', {});
            };
            $scope.resetForm();
        }])
        .controller('ChangePasswordController', ["$scope", "$uibModalInstance", "$http", function ($scope, $uibModalInstance, $http) {
            $scope.msg = {};
            $scope.ok = function (isValid, currentPassword, newPassword) {
                if (isValid) {
                    $scope.showErrors = false;
                    $http.put('service/identity/profile/changePassword', {
                        currentPassword: currentPassword,
                        newPassword: newPassword
                    })
                        .success(function (user) {
                            $uibModalInstance.dismiss();
                        }).error(function (response, status) {
                        $scope.msg.type = 'error';
                        if (status === 403) {
                            $scope.msg.msg = "ACCESS_DENIED";
                        }
                        else {
                            $scope.msg.msg = "UNKNOWN_ERROR";
                        }
                    });
                } else
                    $scope.showErrors = true;
            };

            $scope.cancel = function () {
                $uibModalInstance.dismiss();
            };
        }])
        .directive('agUser', ["$identity", "$otherwise", function ($identity, $otherwise) {
            return {
                link: function (scope, element, attrs) {
                    var otherwiseKey = element.attr('otherwiseKey') || '';
                    scope.$watch(attrs.agUser, function (userId) {
                        if (userId) {
                            $identity.getUser(userId).then(function (user) {
                                element.text(user.name);
                            }, function () {
                                element.text(userId);
                            });
                        } else {
                            if (otherwiseKey !== '')
                                element.html($otherwise.get(otherwiseKey));
                        }
                    });
                }
            };
        }])
        .directive('agGroup', ["$identity", function ($identity) {
            return {
                link: function (scope, element, attrs) {
                    scope.$watch(attrs.agGroup, function (groupId) {
                        if (groupId) {
                            $identity.getGroup(groupId).then(function (group) {
                                    element.text(group.name);
                                },
                                function () {
                                    element.text(groupId);
                                });
                        }
                    });
                }
            };
        }])
        .directive('agUserPic', ["$identity", function ($identity) {
            return {
                link: function (scope, element, attrs) {
                    scope.$watch(attrs.agUserPic, function (userId) {
                        setUserPicture(userId, element, $identity);
                    });
                }
            };
        }])
        .directive('agUserPicUrl', function () {
            return {
                link: function (scope, element, attrs) {
                    scope.$watch(attrs.agUserPicUrl, function (picUrl) {
                        if (picUrl)
                            element.attr("src", picUrl);
                        else
                            element.attr("src", DEFAULT_USER_PIC);
                    });
                }
            };
        })
        .directive('agIdentityLinkPic', ["$identity", function ($identity) {
            return {
                link: function (scope, element, attrs) {
                    scope.$watch(attrs.agIdentityLinkPic, function (identityLink) {
                        if (identityLink) {
                            var userId = identityLink.user || identityLink.userId;

                            if (userId)
                                setUserPicture(userId, element, $identity);
                            else
                                element.attr("src", DEFAULT_GROUP_PIC);
                        }
                    });
                }
            };
        }])
        .directive('agIdentityLinkName', ["$identity", function ($identity) {
            return {
                link: function (scope, element, attrs) {
                    scope.$watch(attrs.agIdentityLinkName, function (identityLink) {
                        if (identityLink) {
                            var userId = identityLink.user || identityLink.userId;
                            if (userId) {
                                $identity.getUser(userId).then(function (user) {
                                    element.text(user.name);
                                }, function () {
                                    element.text(userId);
                                });
                            } else {
                                var groupId = identityLink.group || identityLink.groupId;
                                if (groupId) {
                                    $identity.getGroup(groupId).then(function (group) {
                                            element.text(group.name);
                                        },
                                        function () {
                                            element.text(groupId);
                                        });
                                }
                            }
                        }
                    });
                }
            };
        }])
        .directive('agIdentityLinkType', ["$identity", "$otherwise", function ($identity, $otherwise) {
            return {
                link: function (scope, element, attrs) {
                    scope.$watch(attrs.agIdentityLinkType, function (identityLinkType) {
                        if (identityLinkType) {
                            var roleName = $otherwise.get('ROLE_' + identityLinkType);

                            //role translate was not found set to original identityLink.type
                            if (roleName === 'ROLE_' + identityLinkType) roleName = identityLinkType;

                            element.html(roleName);
                        }
                    });
                }
            };
        }])
        .directive('agProfilePicPreview', function () {
            return {
                link: function (scope, element, attrs) {
                    scope.$watch(attrs.agProfilePicPreview, function (userPicFile) {
                        if (userPicFile) {
                            if (userPicFile.type.match('image.*')) {
                                var reader = new FileReader();
                                reader.onload = (function (picFile) {
                                    return function (e) {
                                        element.attr("src", e.target.result);
                                    };
                                })(userPicFile);
                                reader.readAsDataURL(userPicFile);
                            }

                        } else if (scope.currentUser.pictureUrl) {
                            element.attr("src", scope.currentUser.pictureUrl);
                        } else {
                            element.attr("src", DEFAULT_USER_PIC);
                        }
                    });
                }
            };
        })
        //filters
        .filter('userName', ["$identity", function ($identity) {
            return function (userId) {
                if (userId)
                    return $identity.getUserName(userId);
            };
        }])
        .filter('groupName', ["$identity", function ($identity) {
            return function (groupId) {
                if (groupId)
                    return $identity.getGroupName(groupId);
            };
        }])
        .filter('identityName', ["$filter", function ($filter) {
            return function (identityId, identityType) {
                if (identityType === 'group')
                    return $filter('groupName')(identityId);

                return $filter('userName')(identityId);
            };
        }]);

})();

(function () {
    'use strict';

    /* agForm */

    function $form(FormData, $injector, formConfig) {

        this.getFormData = function (param, success, fail) {
            FormData.one().get(param).then(
                function (formData) {
                    if (success)
                        success(formData);
                },
                function (response) {
                    if (fail)
                        fail(response);
                }
            );
        };

        this.handleStartForm = function (processDefinitionId, options, noForm, success, fail) {
            var param = {processDefinitionId: processDefinitionId};
            this.getFormData(param, function (formData) {
                handleForm(formData, options, noForm, success, fail);
            }, fail);
        };

        this.handleTaskForm = function (taskId, options, noForm, success, fail) {
            var param = {taskId: taskId};
            this.getFormData(param, function (formData) {
                handleForm(formData, options, noForm, success, fail);
            }, fail);
        };

        this.submitStartForm = function (processDefinitionId, formProperties, success, failure) {
            submitFormData({processDefinitionId: processDefinitionId}, formProperties, success, failure);
        };
        this.submitTaskForm = function (taskId, formProperties, success, failure) {
            submitFormData({taskId: taskId}, formProperties, success, failure);
        };

        this.getFormViewProperties = function (formProperties) {
            var formViewProperties = angular.copy(formProperties);
            for (var i = 0; i < formViewProperties.length; i++) {
                var formPropertyHandler = formConfig.formPropertyHandlers[formViewProperties[i].type] || formConfig.formPropertyHandlers['string'];
                if (formPropertyHandler) {
                    if (formPropertyHandler.viewId)
                        formViewProperties[i].view = formPropertyHandler.viewId;
                    if (formPropertyHandler.initFormProperty)
                        $injector.invoke(formPropertyHandler.initFormProperty, formPropertyHandler, {formProperty: formViewProperties[i]});
                }
            }
            return formViewProperties;
        };

        function handleForm(formData, options, noForm, success, fail) {
            var formHandler = formConfig.formHandlers[formData.formKey];

            if (formHandler)
                $injector.get(formHandler).handleForm(formData, options, noForm, success, fail);

        };

        function submitFormData(formData, formProperties, success, failure) {
            formData.properties = [];
            for (var i = 0; i < formProperties.length; i++) {
                if (formProperties[i].writable === false) continue;
                var formPropertyHandler = formConfig.formPropertyHandlers[formProperties[i].type];
                if (formPropertyHandler) {
                    if (formPropertyHandler.prepareForSubmit)
                        $injector.invoke(formPropertyHandler.prepareForSubmit, formPropertyHandler, {formProperty: formProperties[i]});
                }
                formData.properties.push({id: formProperties[i].id, value: formProperties[i].value});
            }
            FormData.post(formData).then(function (resource) {
                if (success) success(resource);
            }, failure);
        };
    };

    angular.module('agForm', [])
        .factory('FormData', ['Restangular', 'serviceUrl', function (Restangular, serviceUrl) {
            return Restangular.withConfig(function (RestangularConfigurer) {
                RestangularConfigurer.setBaseUrl(serviceUrl + '/form/');
            }).service('form-data');
        }])
        .provider('$form', function $FormProvider() {

            var formConfig = {formHandlers: {}, formPropertyHandlers: {}};

            this.addFormPropertyHandler = function (formPropertyType, formPropertyHandler) {
                formConfig.formPropertyHandlers[formPropertyType] = formPropertyHandler;
            };

            this.addFormHandler = function (formKey, formHandler) {
                formConfig.formHandlers[formKey] = formHandler;
            };

            this.$get = ['FormData', '$injector', function formFactory(FormData, $injector) {
                if (angular.isUndefined(formConfig.formHandlers[null])) {
                    formConfig.formHandlers[null] = 'DefaultFormHandler';
                }
                if (angular.isUndefined(formConfig.formPropertyHandlers['string'])) {
                    formConfig.formPropertyHandlers['string'] = {viewId: 'form/view/string.html'};
                }
                return new $form(FormData, $injector, formConfig);
            }];
        })
        .factory('DefaultFormHandler', ["$ui", "$form", function ($ui, $form) {
            return {
                handleForm: function (formData, options, noForm, success, fail) {
                    if (formData.formProperties.length > 0) {
                        var formProperties = $form.getFormViewProperties(formData.formProperties);
                        $ui.showModal('form/view/form.html', 'FormPropertiesController',
                            {
                                formInfo: function () {
                                    return {formProperties: formProperties, options: options};
                                }
                            }, function (formProperties) {
                                if (formData.taskId !== null)
                                    $form.submitTaskForm(formData.taskId, formProperties, success, fail);
                                else if (formData.processDefinitionId !== null)
                                    $form.submitStartForm(formData.processDefinitionId, formProperties, success, fail);
                            });
                    } else {
                        if (noForm) noForm();
                    }
                }
            };
        }])
        .controller('FormPropertiesController', ["$scope", "$uibModalInstance", "formInfo", function ($scope, $uibModalInstance, formInfo) {
            $scope.readOnly = formInfo.options.isReadOnly || false;
            $scope.title = formInfo.options.title || '_FORM';

            $scope.formProperties = formInfo.formProperties;
            $scope.showErrors = false;

            $scope.submitForm = function (isValid) {
                // check to make sure the form is completely valid
                if (isValid) {
                    $uibModalInstance.close($scope.formProperties);
                } else {
                    $scope.showErrors = true;
                }
            };

            $scope.cancel = function () {
                $uibModalInstance.dismiss('cancel');
            };

        }])
        .directive('agName', ["$compile", function ($compile) {
//	http://stackoverflow.com/questions/14378401/dynamic-validation-and-name-in-a-form-with-angularjs
            return {
                restrict: 'A',
                terminal: true,
                priority: 100000,
                link: function (scope, element, attrs) {
                    var name = scope.$eval(attrs.agName);
                    element.removeAttr('ag-name');
                    element.attr('name', name);
                    $compile(element)(scope);
                }
            };
        }])
        .run(["$ui", "$form", function ($ui, $form) {
            $ui.registerModal('showStartForm', function (processDefinition, options, noForm, success, fail) {
                $form.handleStartForm(processDefinition.id, options, noForm, success, fail);
            });
            $ui.registerModal('showTaskForm', function (task, options, noForm, success, fail) {
                $form.handleTaskForm(task.id, options, noForm, success, fail);
            });

        }]);

})();

(function () {
    'use strict';
    function Diagram($http, svgConfig, serviceUrl) {
        var svgDocuments = {};
        this.renderDefinitionDiagram = function (element, definition) {
            if (svgConfig.enabled && definition.diagramResource.indexOf('svg', definition.diagramResource.length - 3) !== -1) {
                getSvgElement(definition, function (svgElement) {
                    var svg = createSvgElement(svgElement);
                    var outerDiv = angular.element('<div />');
                    var svgCon = angular.element('<div class="svgCon"></div>');
                    svgCon.append(svg);
                    outerDiv.append(svgCon);
                    setElementContent(element, 'svg', outerDiv.html());
                });
            } else {
                setElementContent(element, 'png', "<img src='" + definition.diagramResource.replace("/resources/", "/resourcedata/") + "'>");
            }
        };

        this.renderProcessInstanceDiagram = function (element, processInstance, activities) {

            if (svgConfig.enabled && processInstance.definition.diagramResource.indexOf('svg', processInstance.definition.diagramResource.length - 3) !== -1) {
                renderProcessInstanceSVGDiagram(element, processInstance, activities);
            } else {
                var diagramUrl = serviceUrl + "/runtime/process-instances/" + processInstance.id + "/diagram";
                if (activities.length > 0) {
                    diagramUrl += "?x=" + activities[0];
                    for (var i = 1; i < activities.length; i++)
                        diagramUrl += "_" + activities[i];
                }
                setElementContent(element, 'png', "<img src='" + diagramUrl + "'>");
            }
        };
        function renderProcessInstanceSVGDiagram(element, processInstance, activities) {
            var processId = "process" + processInstance.id;
            var styleElm = element.find('#style_' + processId);
            if (styleElm.length > 0) {
                styleElm.text(createSvgProcessInstanceCssSelectors(processId, activities) + svgConfig.style);
                return;
            }

            getSvgElement(processInstance.definition, function (svgElement) {
                var svg = createSvgElement(svgElement);
                var style = '<style id="style_' + processId + '" type="text/css">' + createSvgProcessInstanceCssSelectors(processId, activities) + svgConfig.style + '</style>';
                var outerDiv = angular.element('<div>' + style + '</div>');
                var svgCon = angular.element('<div class="svgCon"></div>');
                svg.attr('id', processId);
                svgCon.append(svg);
                outerDiv.append(svgCon);
                setElementContent(element, 'svg', outerDiv.html());
            });
        };
        function setElementContent(element, type, html) {
            element.html("<div><span class='" + type + "'>" + type.toUpperCase() + "</span></div>" + html);
        };
        function getSvgElement(definition, success) {
            if (svgDocuments[definition.id]) {
                success(svgDocuments[definition.id]);
            } else {
                $http({
                    method: 'GET',
                    url: definition.diagramResource.replace("/resources/", "/resourcedata/"),
                    cache: true,
                    headers: {
                        'Accept': 'text/html'
                    }
                }).success(function (svgdoc) {
                    var parser = new DOMParser();
                    var doc = parser.parseFromString(svgdoc, "text/xml");

                    processSvgElement(doc);
                    svgDocuments[definition.id] = doc.documentElement;
                    success(doc.documentElement);
                });
            }
        }

        function createSvgElement(svgElement) {
            var parentSvg = angular.element('<svg preserveAspectRatio="xMinYMin"></svg>');
            parentSvg.attr('viewBox', "0 0 " + svgElement.getAttribute('width') + " " + svgElement.getAttribute('height'));
            parentSvg.append(svgElement);
            return parentSvg;
        };

        function processSvgElement(doc) {
            doc.documentElement.removeAttribute('id');
            doc.documentElement.removeAttribute('xmlns:xlink');
            doc.documentElement.removeAttribute('xmlns:svg');
            var def = doc.documentElement.querySelector('svg > defs');
            if (def === undefined || def === null) return;

            var markersMap = {}, markers = def.childNodes || [];

            for (var i = 0; i < markers.length; i++) {
                if (markers[i].tagName === 'marker') {
                    markersMap[markers[i].getAttribute('id')] = markers[i];
                }
            }

            //var paths = doc.documentElement.querySelectorAll('[marker-end]');
            var paths = doc.documentElement.querySelectorAll('svg > g > g > g:last-child [marker-end]');
            for (var i = 0; i < paths.length; i++) {
                var path = paths.item(i), markStartUrl = path.getAttribute('marker-start'), markEndUrl = path.getAttribute('marker-end');
                if (markStartUrl) {
                    markStartUrl = markStartUrl.substring(5, markStartUrl.length - 1);
                    var markStartSID = markStartUrl.substring(0, markStartUrl.length - 5);
                    var markStart = markersMap[markStartUrl];
                    if (markStart) {
                        var markerPaths = markStart.childNodes || [], isDefault = false, isConditional = false, type = '';
                        for (var j = 0; j < markerPaths.length; j++) {
                            if (markerPaths[j].tagName === 'path') {
                                if (markerPaths[j].getAttribute('display') !== 'none') {
                                    if (markerPaths[j].getAttribute('id') === (markStartSID + 'default')) {
                                        isDefault = true;
                                    } else if (markerPaths[j].getAttribute('id') === (markStartSID + 'conditional')) {
                                        isConditional = true;
                                    }
                                }
                            }
                        }
                        if (isConditional === true) {
                            type += '_conditional';
                        }

                        if (isDefault === true) {
                            type += '_default';
                        }

                        if (type === '') {
                            path.removeAttribute('marker-start');
                        } else {
                            path.setAttribute('marker-start', 'url(#_start_marker' + type + ')');
                            //Chrome doesn't support external linking
                            //path.setAttribute('marker-start','url(img/defs.svg#_start_marker'+type+')');
                        }
                    }
                }

                if (markEndUrl) {
                    markEndUrl = markEndUrl.substring(5, markEndUrl.length - 1);
                    var markEnd = markersMap[markEndUrl];
                    if (markEnd) {
                        path.setAttribute('marker-end', 'url(#_end_marker)');
                        //Chrome doesn't support external linking
                        //path.setAttribute('marker-end','url(img/defs.svg#_end_marker)');
                    }
                }
            }
            //def.remove(); doesn't work on Opera!!
            doc.documentElement.removeChild(def);
        }

        function createSvgProcessInstanceCssSelectors(processId, activities) {
            var activeSelectors = "";
            if (activities.length > 0) {
                activeSelectors += "#" + processId + " #" + activities[0] + " > .stencils > .me > g > rect, #" + processId + " #" + activities[0] + " > .stencils > .me > g > circle";
                for (var i = 1; i < activities.length; i++)
                    activeSelectors += ", #" + processId + " #" + activities[i] + " > .stencils > .me > g > rect, #" + processId + " #" + activities[i] + " > .stencils > .me > g > circle";
            }
            return activeSelectors;
        }
    };

    angular.module('actDiagram', [])
        .provider('$diagram', ['serviceUrl', function $DiagramProvider(serviceUrl) {
            var svgConfig = {enabled: true, style: '{stroke: #ff0000;stroke-width: 3;}'};

            this.setSvgEnabled = function (enabled) {
                svgConfig.enabled = enabled;
            };
            this.setSvgStyle = function (svgStyle) {
                svgConfig.style = svgStyle;
            };
            this.$get = ['$http', function sessionFactory($http) {
                return new Diagram($http, svgConfig, serviceUrl);
            }];
        }])
        .directive('agProcessActivities', ["$diagram", "$otherwise", function ($diagram, $otherwise) {
            return {
                link: function (scope, element, attrs) {
                    var otherwiseKey = element.attr('otherwiseKey') || '';

                    scope.$watch(attrs.agProcessActivities, function (activities) {
                        var processInstance = scope.$eval(attrs.agProcessDiagram);
                        if (processInstance) {
                            if (processInstance.definition) {
                                if (processInstance.definition.graphicalNotationDefined && processInstance.endTime === null) {
                                    if (activities === undefined) {
                                        processInstance.refreshActivityIds();
                                        return;
                                    }
                                    $diagram.renderProcessInstanceDiagram(element, processInstance, activities);

                                } else if (processInstance.definition.diagramResource) {
                                    var html = "<div><span>" + $otherwise.get(otherwiseKey) + "</span></div>";
                                    html += "<img src='" + processInstance.definition.diagramResource.replace("/resources/", "/resourcedata/") + "'>";
                                    element.html(html);
                                } else if (otherwiseKey !== '') {
                                    element.html("<span>" + $otherwise.get(otherwiseKey) + "</span>");
                                }
                            }
                        }
                    });
                }
            };
        }])
        .directive('agDefinitionDiagram', ["$otherwise", "$diagram", function ($otherwise, $diagram) {
            return {
                link: function (scope, element, attrs) {
                    var otherwiseKey = element.attr('otherwiseKey') || '';
                    scope.$watch(attrs.agDefinitionDiagram, function (definition) {
                        if (definition) {
                            if (definition.diagramResource) {
                                $diagram.renderDefinitionDiagram(element, definition);
                            } else {
                                if (otherwiseKey !== '')
                                    element.html("<span>" + $otherwise.get(otherwiseKey) + "</span>");
                            }
                        }
                    });
                }
            };
        }]);

})();

(function () {
    'use strict';
    angular.module('act-ui')
        .config(['$routeProvider', function ($routeProvider) {
            // when('/home', {
            // 	title: 'HOME',
            // 	resolve: {page: function(){return {};}}
            // }).
            $routeProvider
                .when('/dashboard', {
                    title: 'Dashboard',
                    resolve: {
                        page: function () {
                            return {template: 'dashboard/view/dashboard.html'};
                        }
                    }
                })
                .when('/account/profile', {
                    title: 'PROFILE',
                    resolve: {
                        page: function () {
                            return {template: 'account/view/profile.html'};
                        }
                    }
                })
                .when('/account/preferences', {
                    title: 'PREFERENCES',
                    resolve: {
                        page: function () {
                            return {template: 'views/account/preferences.html'};
                        }
                    }
                })
                .when('/tasks/inbox/:taskId?', {
                    title: 'INBOX',
                    resolve: {
                        page: ["$taskPage", "$route", function ($taskPage, $route) {
                            return $taskPage.getInboxPage($route.current.params.taskId);
                        }]
                    }
                })
                .when('/tasks/mytasks/:taskId?', {
                    title: 'MYTASKS',
                    resolve: {
                        page: ["$taskPage", "$route", function ($taskPage, $route) {
                            return $taskPage.getMyTasksPage($route.current.params.taskId);
                        }]
                    }
                })
                .when('/tasks/involved/:taskId?', {
                    title: 'INVOLVED',
                    resolve: {
                        page: ["$taskPage", "$route", function ($taskPage, $route) {
                            return $taskPage.getInvolvedPage($route.current.params.taskId);
                        }]
                    }
                })
                .when('/tasks/queued/:taskId?', {
                    title: 'QUEUED',
                    resolve: {
                        page: ["$taskPage", "$route", function ($taskPage, $route) {
                            return $taskPage.getQueuedPage($route.current.params.taskId);
                        }]
                    }
                })
                .when('/tasks/archived/:taskId?', {
                    title: 'ARCHIVED',
                    resolve: {
                        page: ["$taskPage", "$route", function ($taskPage, $route) {
                            return $taskPage.getArchivedPage($route.current.params.taskId);
                        }]
                    }
                })
                .when('/tasks/:any*', {
                    redirectTo: function (params) {
                        return '/tasks/inbox';
                    }
                })
                .otherwise({
                    redirectTo: '/dashboard'
                });
        }]);
})();

angular.module('act-charts', ['act-core']);

(function (module) {
    'use strict';
    module.config(['$routeProvider', function ($routeProvider) {
        $routeProvider
            // .state('charts', {
            //     abstract: true,
            //     template: '<ui-view></ui-view>'
            // })
            .when('/charts/line-chart', {
                title: '线图',
                controller: 'lineChartCtrl',
                templateUrl: 'chart/view/line-chart.html'
            })
            .when('/charts/bar-chart', {
                title: '柱状图',
                controller: 'barChartCtrl',
                templateUrl: 'chart/view/bar-chart.html'
            })
            .when('/charts/pie-chart', {
                title: '饼图',
                controller: 'pieChartCtrl',
                templateUrl: 'chart/view/pie-chart.html'
            });
    }])
})(angular.module('act-charts'));

(function (module) {
    module
        .directive('eCharts', ['$window', function ($window) {
            return {
                link: function (scope, element, attr) {
                    var dom = element[0];
                    dom.style.width = attr.width;
                    dom.style.height = attr.height;

                    var myChart = echarts.init(dom);

                    myChart.setOption(scope.options);

                    $window.addEventListener('resize', function() {
                        myChart.resize();
                    });

                }
            }
        }]);
})(angular.module('act-charts'));

(function (module) {
    module
        .controller('pieChartCtrl', ['$scope', function($scope) {
            var options = {
                title : {
                    text: '某站点用户访问来源',
                    subtext: '纯属虚构',
                    x:'center'
                },
                tooltip : {
                    trigger: 'item',
                    formatter: "{a} <br/>{b} : {c} ({d}%)"
                },
                legend: {
                    orient: 'vertical',
                    left: 'left',
                    data: ['直接访问','邮件营销','联盟广告','视频广告','搜索引擎']
                },
                series : [
                    {
                        name: '访问来源',
                        type: 'pie',
                        radius : '55%',
                        center: ['50%', '60%'],
                        data:[
                            {value:335, name:'直接访问'},
                            {value:310, name:'邮件营销'},
                            {value:234, name:'联盟广告'},
                            {value:135, name:'视频广告'},
                            {value:1548, name:'搜索引擎'}
                        ],
                        itemStyle: {
                            emphasis: {
                                shadowBlur: 10,
                                shadowOffsetX: 0,
                                shadowColor: 'rgba(0, 0, 0, 0.5)'
                            }
                        }
                    }
                ]
            };

            $scope.options = options;
        }])
        .controller('barChartCtrl', ['$scope', function($scope) {
            var options = {
                tooltip : {
                    trigger: 'axis',
                    axisPointer : {            // 坐标轴指示器，坐标轴触发有效
                        type : 'shadow'        // 默认为直线，可选为：'line' | 'shadow'
                    }
                },
                legend: {
                    data:['直接访问','邮件营销','联盟广告','视频广告','搜索引擎','百度','谷歌','必应','其他']
                },
                grid: {
                    left: '3%',
                    right: '4%',
                    bottom: '3%',
                    containLabel: true
                },
                xAxis : [
                    {
                        type : 'category',
                        data : ['周一','周二','周三','周四','周五','周六','周日']
                    }
                ],
                yAxis : [
                    {
                        type : 'value'
                    }
                ],
                series : [
                    {
                        name:'直接访问',
                        type:'bar',
                        data:[320, 332, 301, 334, 390, 330, 320]
                    },
                    {
                        name:'邮件营销',
                        type:'bar',
                        stack: '广告',
                        data:[120, 132, 101, 134, 90, 230, 210]
                    },
                    {
                        name:'联盟广告',
                        type:'bar',
                        stack: '广告',
                        data:[220, 182, 191, 234, 290, 330, 310]
                    },
                    {
                        name:'视频广告',
                        type:'bar',
                        stack: '广告',
                        data:[150, 232, 201, 154, 190, 330, 410]
                    },
                    {
                        name:'搜索引擎',
                        type:'bar',
                        data:[862, 1018, 964, 1026, 1679, 1600, 1570],
                        markLine : {
                            lineStyle: {
                                normal: {
                                    type: 'dashed'
                                }
                            },
                            data : [
                                [{type : 'min'}, {type : 'max'}]
                            ]
                        }
                    },
                    {
                        name:'百度',
                        type:'bar',
                        barWidth : 5,
                        stack: '搜索引擎',
                        data:[620, 732, 701, 734, 1090, 1130, 1120]
                    },
                    {
                        name:'谷歌',
                        type:'bar',
                        stack: '搜索引擎',
                        data:[120, 132, 101, 134, 290, 230, 220]
                    },
                    {
                        name:'必应',
                        type:'bar',
                        stack: '搜索引擎',
                        data:[60, 72, 71, 74, 190, 130, 110]
                    },
                    {
                        name:'其他',
                        type:'bar',
                        stack: '搜索引擎',
                        data:[62, 82, 91, 84, 109, 110, 120]
                    }
                ]
            };

            $scope.options = options;
        }])
        .controller('lineChartCtrl', ['$scope', function($scope) {
            var timeData = [
                '2009/6/12 2:00', '2009/6/12 3:00', '2009/6/12 4:00', '2009/6/12 5:00', '2009/6/12 6:00', '2009/6/12 7:00', '2009/6/12 8:00', '2009/6/12 9:00', '2009/6/12 10:00', '2009/6/12 11:00', '2009/6/12 12:00', '2009/6/12 13:00', '2009/6/12 14:00', '2009/6/12 15:00', '2009/6/12 16:00', '2009/6/12 17:00', '2009/6/12 18:00', '2009/6/12 19:00', '2009/6/12 20:00', '2009/6/12 21:00', '2009/6/12 22:00', '2009/6/12 23:00',
                '2009/6/13 0:00', '2009/6/13 1:00', '2009/6/13 2:00', '2009/6/13 3:00', '2009/6/13 4:00', '2009/6/13 5:00', '2009/6/13 6:00', '2009/6/13 7:00', '2009/6/13 8:00', '2009/6/13 9:00', '2009/6/13 10:00', '2009/6/13 11:00', '2009/6/13 12:00', '2009/6/13 13:00', '2009/6/13 14:00', '2009/6/13 15:00', '2009/6/13 16:00', '2009/6/13 17:00', '2009/6/13 18:00', '2009/6/13 19:00', '2009/6/13 20:00', '2009/6/13 21:00', '2009/6/13 22:00', '2009/6/13 23:00',
                '2009/6/14 0:00', '2009/6/14 1:00', '2009/6/14 2:00', '2009/6/14 3:00', '2009/6/14 4:00', '2009/6/14 5:00', '2009/6/14 6:00', '2009/6/14 7:00', '2009/6/14 8:00', '2009/6/14 9:00', '2009/6/14 10:00', '2009/6/14 11:00', '2009/6/14 12:00', '2009/6/14 13:00', '2009/6/14 14:00', '2009/6/14 15:00', '2009/6/14 16:00', '2009/6/14 17:00', '2009/6/14 18:00', '2009/6/14 19:00', '2009/6/14 20:00', '2009/6/14 21:00', '2009/6/14 22:00', '2009/6/14 23:00',
                '2009/6/15 0:00', '2009/6/15 1:00', '2009/6/15 2:00', '2009/6/15 3:00', '2009/6/15 4:00', '2009/6/15 5:00', '2009/6/15 6:00', '2009/6/15 7:00', '2009/6/15 8:00', '2009/6/15 9:00', '2009/6/15 10:00', '2009/6/15 11:00', '2009/6/15 12:00', '2009/6/15 13:00', '2009/6/15 14:00', '2009/6/15 15:00', '2009/6/15 16:00', '2009/6/15 17:00', '2009/6/15 18:00', '2009/6/15 19:00', '2009/6/15 20:00', '2009/6/15 21:00', '2009/6/15 22:00', '2009/6/15 23:00',
                '2009/6/15 0:00', '2009/6/16 1:00', '2009/6/16 2:00', '2009/6/16 3:00', '2009/6/16 4:00', '2009/6/16 5:00', '2009/6/16 6:00', '2009/6/16 7:00', '2009/6/16 8:00', '2009/6/16 9:00', '2009/6/16 10:00', '2009/6/16 11:00', '2009/6/16 12:00', '2009/6/16 13:00', '2009/6/16 14:00', '2009/6/16 15:00', '2009/6/16 16:00', '2009/6/16 17:00', '2009/6/16 18:00', '2009/6/16 19:00', '2009/6/16 20:00', '2009/6/16 21:00', '2009/6/16 22:00', '2009/6/16 23:00',
                '2009/6/15 0:00', '2009/6/17 1:00', '2009/6/17 2:00', '2009/6/17 3:00', '2009/6/17 4:00', '2009/6/17 5:00', '2009/6/17 6:00', '2009/6/17 7:00', '2009/6/17 8:00', '2009/6/17 9:00', '2009/6/17 10:00', '2009/6/17 11:00', '2009/6/17 12:00', '2009/6/17 13:00', '2009/6/17 14:00', '2009/6/17 15:00', '2009/6/17 16:00', '2009/6/17 17:00', '2009/6/17 18:00', '2009/6/17 19:00', '2009/6/17 20:00', '2009/6/17 21:00', '2009/6/17 22:00', '2009/6/17 23:00',
                '2009/6/18 0:00', '2009/6/18 1:00', '2009/6/18 2:00', '2009/6/18 3:00', '2009/6/18 4:00', '2009/6/18 5:00', '2009/6/18 6:00', '2009/6/18 7:00', '2009/6/18 8:00', '2009/6/18 9:00', '2009/6/18 10:00', '2009/6/18 11:00', '2009/6/18 12:00', '2009/6/18 13:00', '2009/6/18 14:00', '2009/6/18 15:00', '2009/6/18 16:00', '2009/6/18 17:00', '2009/6/18 18:00', '2009/6/18 19:00', '2009/6/18 20:00', '2009/6/18 21:00', '2009/6/18 22:00', '2009/6/18 23:00',
                '2009/6/15 0:00', '2009/6/19 1:00', '2009/6/19 2:00', '2009/6/19 3:00', '2009/6/19 4:00', '2009/6/19 5:00', '2009/6/19 6:00', '2009/6/19 7:00', '2009/6/19 8:00', '2009/6/19 9:00', '2009/6/19 10:00', '2009/6/19 11:00', '2009/6/19 12:00', '2009/6/19 13:00', '2009/6/19 14:00', '2009/6/19 15:00', '2009/6/19 16:00', '2009/6/19 17:00', '2009/6/19 18:00', '2009/6/19 19:00', '2009/6/19 20:00', '2009/6/19 21:00', '2009/6/19 22:00', '2009/6/19 23:00',
                '2009/6/20 0:00', '2009/6/20 1:00', '2009/6/20 2:00', '2009/6/20 3:00', '2009/6/20 4:00', '2009/6/20 5:00', '2009/6/20 6:00', '2009/6/20 7:00', '2009/6/20 8:00', '2009/6/20 9:00', '2009/6/20 10:00', '2009/6/20 11:00', '2009/6/20 12:00', '2009/6/20 13:00', '2009/6/20 14:00', '2009/6/20 15:00', '2009/6/20 16:00', '2009/6/20 17:00', '2009/6/20 18:00', '2009/6/20 19:00', '2009/6/20 20:00', '2009/6/20 21:00', '2009/6/20 22:00', '2009/6/20 23:00',
                '2009/6/21 0:00', '2009/6/21 1:00', '2009/6/21 2:00', '2009/6/21 3:00', '2009/6/21 4:00', '2009/6/21 5:00', '2009/6/21 6:00', '2009/6/21 7:00', '2009/6/21 8:00', '2009/6/21 9:00', '2009/6/21 10:00', '2009/6/21 11:00', '2009/6/21 12:00', '2009/6/21 13:00', '2009/6/21 14:00', '2009/6/21 15:00', '2009/6/21 16:00', '2009/6/21 17:00', '2009/6/21 18:00', '2009/6/21 19:00', '2009/6/21 20:00', '2009/6/21 21:00', '2009/6/21 22:00', '2009/6/21 23:00',
                '2009/6/22 0:00', '2009/6/22 1:00', '2009/6/22 2:00', '2009/6/22 3:00', '2009/6/22 4:00', '2009/6/22 5:00', '2009/6/22 6:00', '2009/6/22 7:00', '2009/6/22 8:00', '2009/6/22 9:00', '2009/6/22 10:00', '2009/6/22 11:00', '2009/6/22 12:00', '2009/6/22 13:00', '2009/6/22 14:00', '2009/6/22 15:00', '2009/6/22 16:00', '2009/6/22 17:00', '2009/6/22 18:00', '2009/6/22 19:00', '2009/6/22 20:00', '2009/6/22 21:00', '2009/6/22 22:00', '2009/6/22 23:00',
                '2009/6/23 0:00', '2009/6/23 1:00', '2009/6/23 2:00', '2009/6/23 3:00', '2009/6/23 4:00', '2009/6/23 5:00', '2009/6/23 6:00', '2009/6/23 7:00', '2009/6/23 8:00', '2009/6/23 9:00', '2009/6/23 10:00', '2009/6/23 11:00', '2009/6/23 12:00', '2009/6/23 13:00', '2009/6/23 14:00', '2009/6/23 15:00', '2009/6/23 16:00', '2009/6/23 17:00', '2009/6/23 18:00', '2009/6/23 19:00', '2009/6/23 20:00', '2009/6/23 21:00', '2009/6/23 22:00', '2009/6/23 23:00',
                '2009/6/24 0:00', '2009/6/24 1:00', '2009/6/24 2:00', '2009/6/24 3:00', '2009/6/24 4:00', '2009/6/24 5:00', '2009/6/24 6:00', '2009/6/24 7:00', '2009/6/24 8:00', '2009/6/24 9:00', '2009/6/24 10:00', '2009/6/24 11:00', '2009/6/24 12:00', '2009/6/24 13:00', '2009/6/24 14:00', '2009/6/24 15:00', '2009/6/24 16:00', '2009/6/24 17:00', '2009/6/24 18:00', '2009/6/24 19:00', '2009/6/24 20:00', '2009/6/24 21:00', '2009/6/24 22:00', '2009/6/24 23:00',
                '2009/6/25 0:00', '2009/6/25 1:00', '2009/6/25 2:00', '2009/6/25 3:00', '2009/6/25 4:00', '2009/6/25 5:00', '2009/6/25 6:00', '2009/6/25 7:00', '2009/6/25 8:00', '2009/6/25 9:00', '2009/6/25 10:00', '2009/6/25 11:00', '2009/6/25 12:00', '2009/6/25 13:00', '2009/6/25 14:00', '2009/6/25 15:00', '2009/6/25 16:00', '2009/6/25 17:00', '2009/6/25 18:00', '2009/6/25 19:00', '2009/6/25 20:00', '2009/6/25 21:00', '2009/6/25 22:00', '2009/6/25 23:00',
                '2009/6/26 0:00', '2009/6/26 1:00', '2009/6/26 2:00', '2009/6/26 3:00', '2009/6/26 4:00', '2009/6/26 5:00', '2009/6/26 6:00', '2009/6/26 7:00', '2009/6/26 8:00', '2009/6/26 9:00', '2009/6/26 10:00', '2009/6/26 11:00', '2009/6/26 12:00', '2009/6/26 13:00', '2009/6/26 14:00', '2009/6/26 15:00', '2009/6/26 16:00', '2009/6/26 17:00', '2009/6/26 18:00', '2009/6/26 19:00', '2009/6/26 20:00', '2009/6/26 21:00', '2009/6/26 22:00', '2009/6/26 23:00',
                '2009/6/27 0:00', '2009/6/27 1:00', '2009/6/27 2:00', '2009/6/27 3:00', '2009/6/27 4:00', '2009/6/27 5:00', '2009/6/27 6:00', '2009/6/27 7:00', '2009/6/27 8:00', '2009/6/27 9:00', '2009/6/27 10:00', '2009/6/27 11:00', '2009/6/27 12:00', '2009/6/27 13:00', '2009/6/27 14:00', '2009/6/27 15:00', '2009/6/27 16:00', '2009/6/27 17:00', '2009/6/27 18:00', '2009/6/27 19:00', '2009/6/27 20:00', '2009/6/27 21:00', '2009/6/27 22:00', '2009/6/27 23:00',
                '2009/6/28 0:00', '2009/6/28 1:00', '2009/6/28 2:00', '2009/6/28 3:00', '2009/6/28 4:00', '2009/6/28 5:00', '2009/6/28 6:00', '2009/6/28 7:00', '2009/6/28 8:00', '2009/6/28 9:00', '2009/6/28 10:00', '2009/6/28 11:00', '2009/6/28 12:00', '2009/6/28 13:00', '2009/6/28 14:00', '2009/6/28 15:00', '2009/6/28 16:00', '2009/6/28 17:00', '2009/6/28 18:00', '2009/6/28 19:00', '2009/6/28 20:00', '2009/6/28 21:00', '2009/6/28 22:00', '2009/6/28 23:00',
                '2009/6/29 0:00', '2009/6/29 1:00', '2009/6/29 2:00', '2009/6/29 3:00', '2009/6/29 4:00', '2009/6/29 5:00', '2009/6/29 6:00', '2009/6/29 7:00', '2009/6/29 8:00', '2009/6/29 9:00', '2009/6/29 10:00', '2009/6/29 11:00', '2009/6/29 12:00', '2009/6/29 13:00', '2009/6/29 14:00', '2009/6/29 15:00', '2009/6/29 16:00', '2009/6/29 17:00', '2009/6/29 18:00', '2009/6/29 19:00', '2009/6/29 20:00', '2009/6/29 21:00', '2009/6/29 22:00', '2009/6/29 23:00',
                '2009/6/30 0:00', '2009/6/30 1:00', '2009/6/30 2:00', '2009/6/30 3:00', '2009/6/30 4:00', '2009/6/30 5:00', '2009/6/30 6:00', '2009/6/30 7:00', '2009/6/30 8:00', '2009/6/30 9:00', '2009/6/30 10:00', '2009/6/30 11:00', '2009/6/30 12:00', '2009/6/30 13:00', '2009/6/30 14:00', '2009/6/30 15:00', '2009/6/30 16:00', '2009/6/30 17:00', '2009/6/30 18:00', '2009/6/30 19:00', '2009/6/30 20:00', '2009/6/30 21:00', '2009/6/30 22:00', '2009/6/30 23:00',
                '2009/7/1 0:00', '2009/7/1 1:00', '2009/7/1 2:00', '2009/7/1 3:00', '2009/7/1 4:00', '2009/7/1 5:00', '2009/7/1 6:00', '2009/7/1 7:00', '2009/7/1 8:00', '2009/7/1 9:00', '2009/7/1 10:00', '2009/7/1 11:00', '2009/7/1 12:00', '2009/7/1 13:00', '2009/7/1 14:00', '2009/7/1 15:00', '2009/7/1 16:00', '2009/7/1 17:00', '2009/7/1 18:00', '2009/7/1 19:00', '2009/7/1 20:00', '2009/7/1 21:00', '2009/7/1 22:00', '2009/7/1 23:00',
                '2009/7/2 0:00', '2009/7/2 1:00', '2009/7/2 2:00', '2009/7/2 3:00', '2009/7/2 4:00', '2009/7/2 5:00', '2009/7/2 6:00', '2009/7/2 7:00', '2009/7/2 8:00', '2009/7/2 9:00', '2009/7/2 10:00', '2009/7/2 11:00', '2009/7/2 12:00', '2009/7/2 13:00', '2009/7/2 14:00', '2009/7/2 15:00', '2009/7/2 16:00', '2009/7/2 17:00', '2009/7/2 18:00', '2009/7/2 19:00', '2009/7/2 20:00', '2009/7/2 21:00', '2009/7/2 22:00', '2009/7/2 23:00',
                '2009/7/3 0:00', '2009/7/3 1:00', '2009/7/3 2:00', '2009/7/3 3:00', '2009/7/3 4:00', '2009/7/3 5:00', '2009/7/3 6:00', '2009/7/3 7:00', '2009/7/3 8:00', '2009/7/3 9:00', '2009/7/3 10:00', '2009/7/3 11:00', '2009/7/3 12:00', '2009/7/3 13:00', '2009/7/3 14:00', '2009/7/3 15:00', '2009/7/3 16:00', '2009/7/3 17:00', '2009/7/3 18:00', '2009/7/3 19:00', '2009/7/3 20:00', '2009/7/3 21:00', '2009/7/3 22:00', '2009/7/3 23:00',
                '2009/7/4 0:00', '2009/7/4 1:00', '2009/7/4 2:00', '2009/7/4 3:00', '2009/7/4 4:00', '2009/7/4 5:00', '2009/7/4 6:00', '2009/7/4 7:00', '2009/7/4 8:00', '2009/7/4 9:00', '2009/7/4 10:00', '2009/7/4 11:00', '2009/7/4 12:00', '2009/7/4 13:00', '2009/7/4 14:00', '2009/7/4 15:00', '2009/7/4 16:00', '2009/7/4 17:00', '2009/7/4 18:00', '2009/7/4 19:00', '2009/7/4 20:00', '2009/7/4 21:00', '2009/7/4 22:00', '2009/7/4 23:00',
                '2009/7/5 0:00', '2009/7/5 1:00', '2009/7/5 2:00', '2009/7/5 3:00', '2009/7/5 4:00', '2009/7/5 5:00', '2009/7/5 6:00', '2009/7/5 7:00', '2009/7/5 8:00', '2009/7/5 9:00', '2009/7/5 10:00', '2009/7/5 11:00', '2009/7/5 12:00', '2009/7/5 13:00', '2009/7/5 14:00', '2009/7/5 15:00', '2009/7/5 16:00', '2009/7/5 17:00', '2009/7/5 18:00', '2009/7/5 19:00', '2009/7/5 20:00', '2009/7/5 21:00', '2009/7/5 22:00', '2009/7/5 23:00',
                '2009/7/6 0:00', '2009/7/6 1:00', '2009/7/6 2:00', '2009/7/6 3:00', '2009/7/6 4:00', '2009/7/6 5:00', '2009/7/6 6:00', '2009/7/6 7:00', '2009/7/6 8:00', '2009/7/6 9:00', '2009/7/6 10:00', '2009/7/6 11:00', '2009/7/6 12:00', '2009/7/6 13:00', '2009/7/6 14:00', '2009/7/6 15:00', '2009/7/6 16:00', '2009/7/6 17:00', '2009/7/6 18:00', '2009/7/6 19:00', '2009/7/6 20:00', '2009/7/6 21:00', '2009/7/6 22:00', '2009/7/6 23:00',
                '2009/7/7 0:00', '2009/7/7 1:00', '2009/7/7 2:00', '2009/7/7 3:00', '2009/7/7 4:00', '2009/7/7 5:00', '2009/7/7 6:00', '2009/7/7 7:00', '2009/7/7 8:00', '2009/7/7 9:00', '2009/7/7 10:00', '2009/7/7 11:00', '2009/7/7 12:00', '2009/7/7 13:00', '2009/7/7 14:00', '2009/7/7 15:00', '2009/7/7 16:00', '2009/7/7 17:00', '2009/7/7 18:00', '2009/7/7 19:00', '2009/7/7 20:00', '2009/7/7 21:00', '2009/7/7 22:00', '2009/7/7 23:00',
                '2009/7/8 0:00', '2009/7/8 1:00', '2009/7/8 2:00', '2009/7/8 3:00', '2009/7/8 4:00', '2009/7/8 5:00', '2009/7/8 6:00', '2009/7/8 7:00', '2009/7/8 8:00', '2009/7/8 9:00', '2009/7/8 10:00', '2009/7/8 11:00', '2009/7/8 12:00', '2009/7/8 13:00', '2009/7/8 14:00', '2009/7/8 15:00', '2009/7/8 16:00', '2009/7/8 17:00', '2009/7/8 18:00', '2009/7/8 19:00', '2009/7/8 20:00', '2009/7/8 21:00', '2009/7/8 22:00', '2009/7/8 23:00',
                '2009/7/9 0:00', '2009/7/9 1:00', '2009/7/9 2:00', '2009/7/9 3:00', '2009/7/9 4:00', '2009/7/9 5:00', '2009/7/9 6:00', '2009/7/9 7:00', '2009/7/9 8:00', '2009/7/9 9:00', '2009/7/9 10:00', '2009/7/9 11:00', '2009/7/9 12:00', '2009/7/9 13:00', '2009/7/9 14:00', '2009/7/9 15:00', '2009/7/9 16:00', '2009/7/9 17:00', '2009/7/9 18:00', '2009/7/9 19:00', '2009/7/9 20:00', '2009/7/9 21:00', '2009/7/9 22:00', '2009/7/9 23:00',
                '2009/7/10 0:00', '2009/7/10 1:00', '2009/7/10 2:00', '2009/7/10 3:00', '2009/7/10 4:00', '2009/7/10 5:00', '2009/7/10 6:00', '2009/7/10 7:00', '2009/7/10 8:00', '2009/7/10 9:00', '2009/7/10 10:00', '2009/7/10 11:00', '2009/7/10 12:00', '2009/7/10 13:00', '2009/7/10 14:00', '2009/7/10 15:00', '2009/7/10 16:00', '2009/7/10 17:00', '2009/7/10 18:00', '2009/7/10 19:00', '2009/7/10 20:00', '2009/7/10 21:00', '2009/7/10 22:00', '2009/7/10 23:00',
                '2009/7/11 0:00', '2009/7/11 1:00', '2009/7/11 2:00', '2009/7/11 3:00', '2009/7/11 4:00', '2009/7/11 5:00', '2009/7/11 6:00', '2009/7/11 7:00', '2009/7/11 8:00', '2009/7/11 9:00', '2009/7/11 10:00', '2009/7/11 11:00', '2009/7/11 12:00', '2009/7/11 13:00', '2009/7/11 14:00', '2009/7/11 15:00', '2009/7/11 16:00', '2009/7/11 17:00', '2009/7/11 18:00', '2009/7/11 19:00', '2009/7/11 20:00', '2009/7/11 21:00', '2009/7/11 22:00', '2009/7/11 23:00',
                '2009/7/12 0:00', '2009/7/12 1:00', '2009/7/12 2:00', '2009/7/12 3:00', '2009/7/12 4:00', '2009/7/12 5:00', '2009/7/12 6:00', '2009/7/12 7:00', '2009/7/12 8:00', '2009/7/12 9:00', '2009/7/12 10:00', '2009/7/12 11:00', '2009/7/12 12:00', '2009/7/12 13:00', '2009/7/12 14:00', '2009/7/12 15:00', '2009/7/12 16:00', '2009/7/12 17:00', '2009/7/12 18:00', '2009/7/12 19:00', '2009/7/12 20:00', '2009/7/12 21:00', '2009/7/12 22:00', '2009/7/12 23:00',
                '2009/7/13 0:00', '2009/7/13 1:00', '2009/7/13 2:00', '2009/7/13 3:00', '2009/7/13 4:00', '2009/7/13 5:00', '2009/7/13 6:00', '2009/7/13 7:00', '2009/7/13 8:00', '2009/7/13 9:00', '2009/7/13 10:00', '2009/7/13 11:00', '2009/7/13 12:00', '2009/7/13 13:00', '2009/7/13 14:00', '2009/7/13 15:00', '2009/7/13 16:00', '2009/7/13 17:00', '2009/7/13 18:00', '2009/7/13 19:00', '2009/7/13 20:00', '2009/7/13 21:00', '2009/7/13 22:00', '2009/7/13 23:00',
                '2009/7/14 0:00', '2009/7/14 1:00', '2009/7/14 2:00', '2009/7/14 3:00', '2009/7/14 4:00', '2009/7/14 5:00', '2009/7/14 6:00', '2009/7/14 7:00', '2009/7/14 8:00', '2009/7/14 9:00', '2009/7/14 10:00', '2009/7/14 11:00', '2009/7/14 12:00', '2009/7/14 13:00', '2009/7/14 14:00', '2009/7/14 15:00', '2009/7/14 16:00', '2009/7/14 17:00', '2009/7/14 18:00', '2009/7/14 19:00', '2009/7/14 20:00', '2009/7/14 21:00', '2009/7/14 22:00', '2009/7/14 23:00',
                '2009/7/15 0:00', '2009/7/15 1:00', '2009/7/15 2:00', '2009/7/15 3:00', '2009/7/15 4:00', '2009/7/15 5:00', '2009/7/15 6:00', '2009/7/15 7:00', '2009/7/15 8:00', '2009/7/15 9:00', '2009/7/15 10:00', '2009/7/15 11:00', '2009/7/15 12:00', '2009/7/15 13:00', '2009/7/15 14:00', '2009/7/15 15:00', '2009/7/15 16:00', '2009/7/15 17:00', '2009/7/15 18:00', '2009/7/15 19:00', '2009/7/15 20:00', '2009/7/15 21:00', '2009/7/15 22:00', '2009/7/15 23:00',
                '2009/7/16 0:00', '2009/7/16 1:00', '2009/7/16 2:00', '2009/7/16 3:00', '2009/7/16 4:00', '2009/7/16 5:00', '2009/7/16 6:00', '2009/7/16 7:00', '2009/7/16 8:00', '2009/7/16 9:00', '2009/7/16 10:00', '2009/7/16 11:00', '2009/7/16 12:00', '2009/7/16 13:00', '2009/7/16 14:00', '2009/7/16 15:00', '2009/7/16 16:00', '2009/7/16 17:00', '2009/7/16 18:00', '2009/7/16 19:00', '2009/7/16 20:00', '2009/7/16 21:00', '2009/7/16 22:00', '2009/7/16 23:00',
                '2009/7/17 0:00', '2009/7/17 1:00', '2009/7/17 2:00', '2009/7/17 3:00', '2009/7/17 4:00', '2009/7/17 5:00', '2009/7/17 6:00', '2009/7/17 7:00', '2009/7/17 8:00', '2009/7/17 9:00', '2009/7/17 10:00', '2009/7/17 11:00', '2009/7/17 12:00', '2009/7/17 13:00', '2009/7/17 14:00', '2009/7/17 15:00', '2009/7/17 16:00', '2009/7/17 17:00', '2009/7/17 18:00', '2009/7/17 19:00', '2009/7/17 20:00', '2009/7/17 21:00', '2009/7/17 22:00', '2009/7/17 23:00',
                '2009/7/18 0:00', '2009/7/18 1:00', '2009/7/18 2:00', '2009/7/18 3:00', '2009/7/18 4:00', '2009/7/18 5:00', '2009/7/18 6:00', '2009/7/18 7:00', '2009/7/18 8:00', '2009/7/18 9:00', '2009/7/18 10:00', '2009/7/18 11:00', '2009/7/18 12:00', '2009/7/18 13:00', '2009/7/18 14:00', '2009/7/18 15:00', '2009/7/18 16:00', '2009/7/18 17:00', '2009/7/18 18:00', '2009/7/18 19:00', '2009/7/18 20:00', '2009/7/18 21:00', '2009/7/18 22:00', '2009/7/18 23:00',
                '2009/7/19 0:00', '2009/7/19 1:00', '2009/7/19 2:00', '2009/7/19 3:00', '2009/7/19 4:00', '2009/7/19 5:00', '2009/7/19 6:00', '2009/7/19 7:00', '2009/7/19 8:00', '2009/7/19 9:00', '2009/7/19 10:00', '2009/7/19 11:00', '2009/7/19 12:00', '2009/7/19 13:00', '2009/7/19 14:00', '2009/7/19 15:00', '2009/7/19 16:00', '2009/7/19 17:00', '2009/7/19 18:00', '2009/7/19 19:00', '2009/7/19 20:00', '2009/7/19 21:00', '2009/7/19 22:00', '2009/7/19 23:00',
                '2009/7/20 0:00', '2009/7/20 1:00', '2009/7/20 2:00', '2009/7/20 3:00', '2009/7/20 4:00', '2009/7/20 5:00', '2009/7/20 6:00', '2009/7/20 7:00', '2009/7/20 8:00', '2009/7/20 9:00', '2009/7/20 10:00', '2009/7/20 11:00', '2009/7/20 12:00', '2009/7/20 13:00', '2009/7/20 14:00', '2009/7/20 15:00', '2009/7/20 16:00', '2009/7/20 17:00', '2009/7/20 18:00', '2009/7/20 19:00', '2009/7/20 20:00', '2009/7/20 21:00', '2009/7/20 22:00', '2009/7/20 23:00',
                '2009/7/21 0:00', '2009/7/21 1:00', '2009/7/21 2:00', '2009/7/21 3:00', '2009/7/21 4:00', '2009/7/21 5:00', '2009/7/21 6:00', '2009/7/21 7:00', '2009/7/21 8:00', '2009/7/21 9:00', '2009/7/21 10:00', '2009/7/21 11:00', '2009/7/21 12:00', '2009/7/21 13:00', '2009/7/21 14:00', '2009/7/21 15:00', '2009/7/21 16:00', '2009/7/21 17:00', '2009/7/21 18:00', '2009/7/21 19:00', '2009/7/21 20:00', '2009/7/21 21:00', '2009/7/21 22:00', '2009/7/21 23:00',
                '2009/7/22 0:00', '2009/7/22 1:00', '2009/7/22 2:00', '2009/7/22 3:00', '2009/7/22 4:00', '2009/7/22 5:00', '2009/7/22 6:00', '2009/7/22 7:00', '2009/7/22 8:00', '2009/7/22 9:00', '2009/7/22 10:00', '2009/7/22 11:00', '2009/7/22 12:00', '2009/7/22 13:00', '2009/7/22 14:00', '2009/7/22 15:00', '2009/7/22 16:00', '2009/7/22 17:00', '2009/7/22 18:00', '2009/7/22 19:00', '2009/7/22 20:00', '2009/7/22 21:00', '2009/7/22 22:00', '2009/7/22 23:00',
                '2009/7/23 0:00', '2009/7/23 1:00', '2009/7/23 2:00', '2009/7/23 3:00', '2009/7/23 4:00', '2009/7/23 5:00', '2009/7/23 6:00', '2009/7/23 7:00', '2009/7/23 8:00', '2009/7/23 9:00', '2009/7/23 10:00', '2009/7/23 11:00', '2009/7/23 12:00', '2009/7/23 13:00', '2009/7/23 14:00', '2009/7/23 15:00', '2009/7/23 16:00', '2009/7/23 17:00', '2009/7/23 18:00', '2009/7/23 19:00', '2009/7/23 20:00', '2009/7/23 21:00', '2009/7/23 22:00', '2009/7/23 23:00',
                '2009/7/24 0:00', '2009/7/24 1:00', '2009/7/24 2:00', '2009/7/24 3:00', '2009/7/24 4:00', '2009/7/24 5:00', '2009/7/24 6:00', '2009/7/24 7:00', '2009/7/24 8:00', '2009/7/24 9:00', '2009/7/24 10:00', '2009/7/24 11:00', '2009/7/24 12:00', '2009/7/24 13:00', '2009/7/24 14:00', '2009/7/24 15:00', '2009/7/24 16:00', '2009/7/24 17:00', '2009/7/24 18:00', '2009/7/24 19:00', '2009/7/24 20:00', '2009/7/24 21:00', '2009/7/24 22:00', '2009/7/24 23:00',
                '2009/7/25 0:00', '2009/7/25 1:00', '2009/7/25 2:00', '2009/7/25 3:00', '2009/7/25 4:00', '2009/7/25 5:00', '2009/7/25 6:00', '2009/7/25 7:00', '2009/7/25 8:00', '2009/7/25 9:00', '2009/7/25 10:00', '2009/7/25 11:00', '2009/7/25 12:00', '2009/7/25 13:00', '2009/7/25 14:00', '2009/7/25 15:00', '2009/7/25 16:00', '2009/7/25 17:00', '2009/7/25 18:00', '2009/7/25 19:00', '2009/7/25 20:00', '2009/7/25 21:00', '2009/7/25 22:00', '2009/7/25 23:00',
                '2009/7/26 0:00', '2009/7/26 1:00', '2009/7/26 2:00', '2009/7/26 3:00', '2009/7/26 4:00', '2009/7/26 5:00', '2009/7/26 6:00', '2009/7/26 7:00', '2009/7/26 8:00', '2009/7/26 9:00', '2009/7/26 10:00', '2009/7/26 11:00', '2009/7/26 12:00', '2009/7/26 13:00', '2009/7/26 14:00', '2009/7/26 15:00', '2009/7/26 16:00', '2009/7/26 17:00', '2009/7/26 18:00', '2009/7/26 19:00', '2009/7/26 20:00', '2009/7/26 21:00', '2009/7/26 22:00', '2009/7/26 23:00',
                '2009/7/27 0:00', '2009/7/27 1:00', '2009/7/27 2:00', '2009/7/27 3:00', '2009/7/27 4:00', '2009/7/27 5:00', '2009/7/27 6:00', '2009/7/27 7:00', '2009/7/27 8:00', '2009/7/27 9:00', '2009/7/27 10:00', '2009/7/27 11:00', '2009/7/27 12:00', '2009/7/27 13:00', '2009/7/27 14:00', '2009/7/27 15:00', '2009/7/27 16:00', '2009/7/27 17:00', '2009/7/27 18:00', '2009/7/27 19:00', '2009/7/27 20:00', '2009/7/27 21:00', '2009/7/27 22:00', '2009/7/27 23:00',
                '2009/7/28 0:00', '2009/7/28 1:00', '2009/7/28 2:00', '2009/7/28 3:00', '2009/7/28 4:00', '2009/7/28 5:00', '2009/7/28 6:00', '2009/7/28 7:00', '2009/7/28 8:00', '2009/7/28 9:00', '2009/7/28 10:00', '2009/7/28 11:00', '2009/7/28 12:00', '2009/7/28 13:00', '2009/7/28 14:00', '2009/7/28 15:00', '2009/7/28 16:00', '2009/7/28 17:00', '2009/7/28 18:00', '2009/7/28 19:00', '2009/7/28 20:00', '2009/7/28 21:00', '2009/7/28 22:00', '2009/7/28 23:00',
                '2009/7/29 0:00', '2009/7/29 1:00', '2009/7/29 2:00', '2009/7/29 3:00', '2009/7/29 4:00', '2009/7/29 5:00', '2009/7/29 6:00', '2009/7/29 7:00', '2009/7/29 8:00', '2009/7/29 9:00', '2009/7/29 10:00', '2009/7/29 11:00', '2009/7/29 12:00', '2009/7/29 13:00', '2009/7/29 14:00', '2009/7/29 15:00', '2009/7/29 16:00', '2009/7/29 17:00', '2009/7/29 18:00', '2009/7/29 19:00', '2009/7/29 20:00', '2009/7/29 21:00', '2009/7/29 22:00', '2009/7/29 23:00',
                '2009/7/30 0:00', '2009/7/30 1:00', '2009/7/30 2:00', '2009/7/30 3:00', '2009/7/30 4:00', '2009/7/30 5:00', '2009/7/30 6:00', '2009/7/30 7:00', '2009/7/30 8:00', '2009/7/30 9:00', '2009/7/30 10:00', '2009/7/30 11:00', '2009/7/30 12:00', '2009/7/30 13:00', '2009/7/30 14:00', '2009/7/30 15:00', '2009/7/30 16:00', '2009/7/30 17:00', '2009/7/30 18:00', '2009/7/30 19:00', '2009/7/30 20:00', '2009/7/30 21:00', '2009/7/30 22:00', '2009/7/30 23:00',
                '2009/7/31 0:00', '2009/7/31 1:00', '2009/7/31 2:00', '2009/7/31 3:00', '2009/7/31 4:00', '2009/7/31 5:00', '2009/7/31 6:00', '2009/7/31 7:00', '2009/7/31 8:00', '2009/7/31 9:00', '2009/7/31 10:00', '2009/7/31 11:00', '2009/7/31 12:00', '2009/7/31 13:00', '2009/7/31 14:00', '2009/7/31 15:00', '2009/7/31 16:00', '2009/7/31 17:00', '2009/7/31 18:00', '2009/7/31 19:00', '2009/7/31 20:00', '2009/7/31 21:00', '2009/7/31 22:00', '2009/7/31 23:00',
                '2009/8/1 0:00', '2009/8/1 1:00', '2009/8/1 2:00', '2009/8/1 3:00', '2009/8/1 4:00', '2009/8/1 5:00', '2009/8/1 6:00', '2009/8/1 7:00', '2009/8/1 8:00', '2009/8/1 9:00', '2009/8/1 10:00', '2009/8/1 11:00', '2009/8/1 12:00', '2009/8/1 13:00', '2009/8/1 14:00', '2009/8/1 15:00', '2009/8/1 16:00', '2009/8/1 17:00', '2009/8/1 18:00', '2009/8/1 19:00', '2009/8/1 20:00', '2009/8/1 21:00', '2009/8/1 22:00', '2009/8/1 23:00', '2009/8/2 0:00', '2009/8/2 1:00', '2009/8/2 2:00', '2009/8/2 3:00', '2009/8/2 4:00', '2009/8/2 5:00', '2009/8/2 6:00', '2009/8/2 7:00', '2009/8/2 8:00', '2009/8/2 9:00', '2009/8/2 10:00', '2009/8/2 11:00', '2009/8/2 12:00', '2009/8/2 13:00', '2009/8/2 14:00', '2009/8/2 15:00', '2009/8/2 16:00', '2009/8/2 17:00', '2009/8/2 18:00', '2009/8/2 19:00', '2009/8/2 20:00', '2009/8/2 21:00', '2009/8/2 22:00', '2009/8/2 23:00', '2009/8/3 0:00', '2009/8/3 1:00', '2009/8/3 2:00', '2009/8/3 3:00', '2009/8/3 4:00', '2009/8/3 5:00', '2009/8/3 6:00', '2009/8/3 7:00', '2009/8/3 8:00', '2009/8/3 9:00', '2009/8/3 10:00', '2009/8/3 11:00', '2009/8/3 12:00', '2009/8/3 13:00', '2009/8/3 14:00', '2009/8/3 15:00', '2009/8/3 16:00', '2009/8/3 17:00', '2009/8/3 18:00', '2009/8/3 19:00', '2009/8/3 20:00', '2009/8/3 21:00', '2009/8/3 22:00', '2009/8/3 23:00', '2009/8/4 0:00', '2009/8/4 1:00', '2009/8/4 2:00', '2009/8/4 3:00', '2009/8/4 4:00', '2009/8/4 5:00', '2009/8/4 6:00', '2009/8/4 7:00', '2009/8/4 8:00', '2009/8/4 9:00', '2009/8/4 10:00', '2009/8/4 11:00', '2009/8/4 12:00', '2009/8/4 13:00', '2009/8/4 14:00', '2009/8/4 15:00', '2009/8/4 16:00', '2009/8/4 17:00', '2009/8/4 18:00', '2009/8/4 19:00', '2009/8/4 20:00', '2009/8/4 21:00', '2009/8/4 22:00', '2009/8/4 23:00', '2009/8/5 0:00', '2009/8/5 1:00', '2009/8/5 2:00', '2009/8/5 3:00', '2009/8/5 4:00', '2009/8/5 5:00', '2009/8/5 6:00', '2009/8/5 7:00', '2009/8/5 8:00', '2009/8/5 9:00', '2009/8/5 10:00', '2009/8/5 11:00', '2009/8/5 12:00', '2009/8/5 13:00', '2009/8/5 14:00', '2009/8/5 15:00', '2009/8/5 16:00', '2009/8/5 17:00', '2009/8/5 18:00', '2009/8/5 19:00', '2009/8/5 20:00', '2009/8/5 21:00', '2009/8/5 22:00', '2009/8/5 23:00', '2009/8/6 0:00', '2009/8/6 1:00', '2009/8/6 2:00', '2009/8/6 3:00', '2009/8/6 4:00', '2009/8/6 5:00', '2009/8/6 6:00', '2009/8/6 7:00', '2009/8/6 8:00', '2009/8/6 9:00', '2009/8/6 10:00', '2009/8/6 11:00', '2009/8/6 12:00', '2009/8/6 13:00', '2009/8/6 14:00', '2009/8/6 15:00', '2009/8/6 16:00', '2009/8/6 17:00', '2009/8/6 18:00', '2009/8/6 19:00', '2009/8/6 20:00', '2009/8/6 21:00', '2009/8/6 22:00', '2009/8/6 23:00', '2009/8/7 0:00', '2009/8/7 1:00', '2009/8/7 2:00', '2009/8/7 3:00', '2009/8/7 4:00', '2009/8/7 5:00', '2009/8/7 6:00', '2009/8/7 7:00', '2009/8/7 8:00', '2009/8/7 9:00', '2009/8/7 10:00', '2009/8/7 11:00', '2009/8/7 12:00', '2009/8/7 13:00', '2009/8/7 14:00', '2009/8/7 15:00', '2009/8/7 16:00', '2009/8/7 17:00', '2009/8/7 18:00', '2009/8/7 19:00', '2009/8/7 20:00', '2009/8/7 21:00', '2009/8/7 22:00', '2009/8/7 23:00', '2009/8/8 0:00', '2009/8/8 1:00', '2009/8/8 2:00', '2009/8/8 3:00', '2009/8/8 4:00', '2009/8/8 5:00', '2009/8/8 6:00', '2009/8/8 7:00', '2009/8/8 8:00', '2009/8/8 9:00', '2009/8/8 10:00', '2009/8/8 11:00', '2009/8/8 12:00', '2009/8/8 13:00', '2009/8/8 14:00', '2009/8/8 15:00', '2009/8/8 16:00', '2009/8/8 17:00', '2009/8/8 18:00', '2009/8/8 19:00', '2009/8/8 20:00', '2009/8/8 21:00', '2009/8/8 22:00', '2009/8/8 23:00', '2009/8/9 0:00', '2009/8/9 1:00', '2009/8/9 2:00', '2009/8/9 3:00', '2009/8/9 4:00', '2009/8/9 5:00', '2009/8/9 6:00', '2009/8/9 7:00', '2009/8/9 8:00', '2009/8/9 9:00', '2009/8/9 10:00', '2009/8/9 11:00', '2009/8/9 12:00', '2009/8/9 13:00', '2009/8/9 14:00', '2009/8/9 15:00', '2009/8/9 16:00', '2009/8/9 17:00', '2009/8/9 18:00', '2009/8/9 19:00', '2009/8/9 20:00', '2009/8/9 21:00', '2009/8/9 22:00', '2009/8/9 23:00', '2009/8/10 0:00', '2009/8/10 1:00', '2009/8/10 2:00', '2009/8/10 3:00', '2009/8/10 4:00', '2009/8/10 5:00', '2009/8/10 6:00', '2009/8/10 7:00', '2009/8/10 8:00', '2009/8/10 9:00', '2009/8/10 10:00', '2009/8/10 11:00', '2009/8/10 12:00', '2009/8/10 13:00', '2009/8/10 14:00', '2009/8/10 15:00', '2009/8/10 16:00', '2009/8/10 17:00', '2009/8/10 18:00', '2009/8/10 19:00', '2009/8/10 20:00', '2009/8/10 21:00', '2009/8/10 22:00', '2009/8/10 23:00', '2009/8/11 0:00', '2009/8/11 1:00', '2009/8/11 2:00', '2009/8/11 3:00', '2009/8/11 4:00', '2009/8/11 5:00', '2009/8/11 6:00', '2009/8/11 7:00', '2009/8/11 8:00', '2009/8/11 9:00', '2009/8/11 10:00', '2009/8/11 11:00', '2009/8/11 12:00', '2009/8/11 13:00', '2009/8/11 14:00', '2009/8/11 15:00', '2009/8/11 16:00', '2009/8/11 17:00', '2009/8/11 18:00', '2009/8/11 19:00', '2009/8/11 20:00', '2009/8/11 21:00', '2009/8/11 22:00', '2009/8/11 23:00', '2009/8/12 0:00', '2009/8/12 1:00', '2009/8/12 2:00', '2009/8/12 3:00', '2009/8/12 4:00', '2009/8/12 5:00', '2009/8/12 6:00', '2009/8/12 7:00', '2009/8/12 8:00', '2009/8/12 9:00', '2009/8/12 10:00', '2009/8/12 11:00', '2009/8/12 12:00', '2009/8/12 13:00', '2009/8/12 14:00', '2009/8/12 15:00', '2009/8/12 16:00', '2009/8/12 17:00', '2009/8/12 18:00', '2009/8/12 19:00', '2009/8/12 20:00', '2009/8/12 21:00', '2009/8/12 22:00', '2009/8/12 23:00', '2009/8/13 0:00', '2009/8/13 1:00', '2009/8/13 2:00', '2009/8/13 3:00', '2009/8/13 4:00', '2009/8/13 5:00', '2009/8/13 6:00', '2009/8/13 7:00', '2009/8/13 8:00', '2009/8/13 9:00', '2009/8/13 10:00', '2009/8/13 11:00', '2009/8/13 12:00', '2009/8/13 13:00', '2009/8/13 14:00', '2009/8/13 15:00', '2009/8/13 16:00', '2009/8/13 17:00', '2009/8/13 18:00', '2009/8/13 19:00', '2009/8/13 20:00', '2009/8/13 21:00', '2009/8/13 22:00', '2009/8/13 23:00', '2009/8/14 0:00', '2009/8/14 1:00', '2009/8/14 2:00', '2009/8/14 3:00', '2009/8/14 4:00', '2009/8/14 5:00', '2009/8/14 6:00', '2009/8/14 7:00', '2009/8/14 8:00', '2009/8/14 9:00', '2009/8/14 10:00', '2009/8/14 11:00', '2009/8/14 12:00', '2009/8/14 13:00', '2009/8/14 14:00', '2009/8/14 15:00', '2009/8/14 16:00', '2009/8/14 17:00', '2009/8/14 18:00', '2009/8/14 19:00', '2009/8/14 20:00', '2009/8/14 21:00', '2009/8/14 22:00', '2009/8/14 23:00', '2009/8/15 0:00', '2009/8/15 1:00', '2009/8/15 2:00', '2009/8/15 3:00', '2009/8/15 4:00', '2009/8/15 5:00', '2009/8/15 6:00', '2009/8/15 7:00', '2009/8/15 8:00', '2009/8/15 9:00', '2009/8/15 10:00', '2009/8/15 11:00', '2009/8/15 12:00', '2009/8/15 13:00', '2009/8/15 14:00', '2009/8/15 15:00', '2009/8/15 16:00', '2009/8/15 17:00', '2009/8/15 18:00', '2009/8/15 19:00', '2009/8/15 20:00', '2009/8/15 21:00', '2009/8/15 22:00', '2009/8/15 23:00', '2009/8/16 0:00', '2009/8/16 1:00', '2009/8/16 2:00', '2009/8/16 3:00', '2009/8/16 4:00', '2009/8/16 5:00', '2009/8/16 6:00', '2009/8/16 7:00', '2009/8/16 8:00', '2009/8/16 9:00', '2009/8/16 10:00', '2009/8/16 11:00', '2009/8/16 12:00', '2009/8/16 13:00', '2009/8/16 14:00', '2009/8/16 15:00', '2009/8/16 16:00', '2009/8/16 17:00', '2009/8/16 18:00', '2009/8/16 19:00', '2009/8/16 20:00', '2009/8/16 21:00', '2009/8/16 22:00', '2009/8/16 23:00', '2009/8/17 0:00', '2009/8/17 1:00', '2009/8/17 2:00', '2009/8/17 3:00', '2009/8/17 4:00', '2009/8/17 5:00', '2009/8/17 6:00', '2009/8/17 7:00', '2009/8/17 8:00', '2009/8/17 9:00', '2009/8/17 10:00', '2009/8/17 11:00', '2009/8/17 12:00', '2009/8/17 13:00', '2009/8/17 14:00', '2009/8/17 15:00', '2009/8/17 16:00', '2009/8/17 17:00', '2009/8/17 18:00', '2009/8/17 19:00', '2009/8/17 20:00', '2009/8/17 21:00', '2009/8/17 22:00', '2009/8/17 23:00', '2009/8/18 0:00', '2009/8/18 1:00', '2009/8/18 2:00', '2009/8/18 3:00', '2009/8/18 4:00', '2009/8/18 5:00', '2009/8/18 6:00', '2009/8/18 7:00', '2009/8/18 8:00', '2009/8/18 9:00', '2009/8/18 10:00', '2009/8/18 11:00', '2009/8/18 12:00', '2009/8/18 13:00', '2009/8/18 14:00', '2009/8/18 15:00', '2009/8/18 16:00', '2009/8/18 17:00', '2009/8/18 18:00', '2009/8/18 19:00', '2009/8/18 20:00', '2009/8/18 21:00', '2009/8/18 22:00', '2009/8/18 23:00', '2009/8/19 0:00', '2009/8/19 1:00', '2009/8/19 2:00', '2009/8/19 3:00', '2009/8/19 4:00', '2009/8/19 5:00', '2009/8/19 6:00', '2009/8/19 7:00', '2009/8/19 8:00', '2009/8/19 9:00', '2009/8/19 10:00', '2009/8/19 11:00', '2009/8/19 12:00', '2009/8/19 13:00', '2009/8/19 14:00', '2009/8/19 15:00', '2009/8/19 16:00', '2009/8/19 17:00', '2009/8/19 18:00', '2009/8/19 19:00', '2009/8/19 20:00', '2009/8/19 21:00', '2009/8/19 22:00', '2009/8/19 23:00', '2009/8/20 0:00', '2009/8/20 1:00', '2009/8/20 2:00', '2009/8/20 3:00', '2009/8/20 4:00', '2009/8/20 5:00', '2009/8/20 6:00', '2009/8/20 7:00', '2009/8/20 8:00', '2009/8/20 9:00', '2009/8/20 10:00', '2009/8/20 11:00', '2009/8/20 12:00', '2009/8/20 13:00', '2009/8/20 14:00', '2009/8/20 15:00', '2009/8/20 16:00', '2009/8/20 17:00', '2009/8/20 18:00', '2009/8/20 19:00', '2009/8/20 20:00', '2009/8/20 21:00', '2009/8/20 22:00', '2009/8/20 23:00', '2009/8/21 0:00', '2009/8/21 1:00', '2009/8/21 2:00', '2009/8/21 3:00', '2009/8/21 4:00', '2009/8/21 5:00', '2009/8/21 6:00', '2009/8/21 7:00', '2009/8/21 8:00', '2009/8/21 9:00', '2009/8/21 10:00', '2009/8/21 11:00', '2009/8/21 12:00', '2009/8/21 13:00', '2009/8/21 14:00', '2009/8/21 15:00', '2009/8/21 16:00', '2009/8/21 17:00', '2009/8/21 18:00', '2009/8/21 19:00', '2009/8/21 20:00', '2009/8/21 21:00', '2009/8/21 22:00', '2009/8/21 23:00', '2009/8/22 0:00', '2009/8/22 1:00', '2009/8/22 2:00', '2009/8/22 3:00', '2009/8/22 4:00', '2009/8/22 5:00', '2009/8/22 6:00', '2009/8/22 7:00', '2009/8/22 8:00', '2009/8/22 9:00', '2009/8/22 10:00', '2009/8/22 11:00', '2009/8/22 12:00', '2009/8/22 13:00', '2009/8/22 14:00', '2009/8/22 15:00', '2009/8/22 16:00', '2009/8/22 17:00', '2009/8/22 18:00', '2009/8/22 19:00', '2009/8/22 20:00', '2009/8/22 21:00', '2009/8/22 22:00', '2009/8/22 23:00', '2009/8/23 0:00', '2009/8/23 1:00', '2009/8/23 2:00', '2009/8/23 3:00', '2009/8/23 4:00', '2009/8/23 5:00', '2009/8/23 6:00', '2009/8/23 7:00', '2009/8/23 8:00', '2009/8/23 9:00', '2009/8/23 10:00', '2009/8/23 11:00', '2009/8/23 12:00', '2009/8/23 13:00', '2009/8/23 14:00', '2009/8/23 15:00', '2009/8/23 16:00', '2009/8/23 17:00', '2009/8/23 18:00', '2009/8/23 19:00', '2009/8/23 20:00', '2009/8/23 21:00', '2009/8/23 22:00', '2009/8/23 23:00', '2009/8/24 0:00', '2009/8/24 1:00', '2009/8/24 2:00', '2009/8/24 3:00', '2009/8/24 4:00', '2009/8/24 5:00', '2009/8/24 6:00', '2009/8/24 7:00', '2009/8/24 8:00', '2009/8/24 9:00', '2009/8/24 10:00', '2009/8/24 11:00', '2009/8/24 12:00', '2009/8/24 13:00', '2009/8/24 14:00', '2009/8/24 15:00', '2009/8/24 16:00', '2009/8/24 17:00', '2009/8/24 18:00', '2009/8/24 19:00', '2009/8/24 20:00', '2009/8/24 21:00', '2009/8/24 22:00', '2009/8/24 23:00', '2009/8/25 0:00', '2009/8/25 1:00', '2009/8/25 2:00', '2009/8/25 3:00', '2009/8/25 4:00', '2009/8/25 5:00', '2009/8/25 6:00', '2009/8/25 7:00', '2009/8/25 8:00', '2009/8/25 9:00', '2009/8/25 10:00', '2009/8/25 11:00', '2009/8/25 12:00', '2009/8/25 13:00', '2009/8/25 14:00', '2009/8/25 15:00', '2009/8/25 16:00', '2009/8/25 17:00', '2009/8/25 18:00', '2009/8/25 19:00', '2009/8/25 20:00', '2009/8/25 21:00', '2009/8/25 22:00', '2009/8/25 23:00', '2009/8/26 0:00', '2009/8/26 1:00', '2009/8/26 2:00', '2009/8/26 3:00', '2009/8/26 4:00', '2009/8/26 5:00', '2009/8/26 6:00', '2009/8/26 7:00', '2009/8/26 8:00', '2009/8/26 9:00', '2009/8/26 10:00', '2009/8/26 11:00', '2009/8/26 12:00', '2009/8/26 13:00', '2009/8/26 14:00', '2009/8/26 15:00', '2009/8/26 16:00', '2009/8/26 17:00', '2009/8/26 18:00', '2009/8/26 19:00', '2009/8/26 20:00', '2009/8/26 21:00', '2009/8/26 22:00', '2009/8/26 23:00', '2009/8/27 0:00', '2009/8/27 1:00', '2009/8/27 2:00', '2009/8/27 3:00', '2009/8/27 4:00', '2009/8/27 5:00', '2009/8/27 6:00', '2009/8/27 7:00', '2009/8/27 8:00', '2009/8/27 9:00', '2009/8/27 10:00', '2009/8/27 11:00', '2009/8/27 12:00', '2009/8/27 13:00', '2009/8/27 14:00', '2009/8/27 15:00', '2009/8/27 16:00', '2009/8/27 17:00', '2009/8/27 18:00', '2009/8/27 19:00', '2009/8/27 20:00', '2009/8/27 21:00', '2009/8/27 22:00', '2009/8/27 23:00', '2009/8/28 0:00', '2009/8/28 1:00', '2009/8/28 2:00', '2009/8/28 3:00', '2009/8/28 4:00', '2009/8/28 5:00', '2009/8/28 6:00', '2009/8/28 7:00', '2009/8/28 8:00', '2009/8/28 9:00', '2009/8/28 10:00', '2009/8/28 11:00', '2009/8/28 12:00', '2009/8/28 13:00', '2009/8/28 14:00', '2009/8/28 15:00', '2009/8/28 16:00', '2009/8/28 17:00', '2009/8/28 18:00', '2009/8/28 19:00', '2009/8/28 20:00', '2009/8/28 21:00', '2009/8/28 22:00', '2009/8/28 23:00', '2009/8/29 0:00', '2009/8/29 1:00', '2009/8/29 2:00', '2009/8/29 3:00', '2009/8/29 4:00', '2009/8/29 5:00', '2009/8/29 6:00', '2009/8/29 7:00', '2009/8/29 8:00', '2009/8/29 9:00', '2009/8/29 10:00', '2009/8/29 11:00', '2009/8/29 12:00', '2009/8/29 13:00', '2009/8/29 14:00', '2009/8/29 15:00', '2009/8/29 16:00', '2009/8/29 17:00', '2009/8/29 18:00', '2009/8/29 19:00', '2009/8/29 20:00', '2009/8/29 21:00', '2009/8/29 22:00', '2009/8/29 23:00', '2009/8/30 0:00', '2009/8/30 1:00', '2009/8/30 2:00', '2009/8/30 3:00', '2009/8/30 4:00', '2009/8/30 5:00', '2009/8/30 6:00', '2009/8/30 7:00', '2009/8/30 8:00', '2009/8/30 9:00', '2009/8/30 10:00', '2009/8/30 11:00', '2009/8/30 12:00', '2009/8/30 13:00', '2009/8/30 14:00', '2009/8/30 15:00', '2009/8/30 16:00', '2009/8/30 17:00', '2009/8/30 18:00', '2009/8/30 19:00', '2009/8/30 20:00', '2009/8/30 21:00', '2009/8/30 22:00', '2009/8/30 23:00', '2009/8/31 0:00', '2009/8/31 1:00', '2009/8/31 2:00', '2009/8/31 3:00', '2009/8/31 4:00', '2009/8/31 5:00', '2009/8/31 6:00', '2009/8/31 7:00', '2009/8/31 8:00', '2009/8/31 9:00', '2009/8/31 10:00', '2009/8/31 11:00', '2009/8/31 12:00', '2009/8/31 13:00', '2009/8/31 14:00', '2009/8/31 15:00', '2009/8/31 16:00', '2009/8/31 17:00', '2009/8/31 18:00', '2009/8/31 19:00', '2009/8/31 20:00', '2009/8/31 21:00', '2009/8/31 22:00', '2009/8/31 23:00',
                '2009/9/1 0:00', '2009/9/1 1:00', '2009/9/1 2:00', '2009/9/1 3:00', '2009/9/1 4:00', '2009/9/1 5:00', '2009/9/1 6:00', '2009/9/1 7:00', '2009/9/1 8:00', '2009/9/1 9:00', '2009/9/1 10:00', '2009/9/1 11:00', '2009/9/1 12:00', '2009/9/1 13:00', '2009/9/1 14:00', '2009/9/1 15:00', '2009/9/1 16:00', '2009/9/1 17:00', '2009/9/1 18:00', '2009/9/1 19:00', '2009/9/1 20:00', '2009/9/1 21:00', '2009/9/1 22:00', '2009/9/1 23:00', '2009/9/2 0:00', '2009/9/2 1:00', '2009/9/2 2:00', '2009/9/2 3:00', '2009/9/2 4:00', '2009/9/2 5:00', '2009/9/2 6:00', '2009/9/2 7:00', '2009/9/2 8:00', '2009/9/2 9:00', '2009/9/2 10:00', '2009/9/2 11:00', '2009/9/2 12:00', '2009/9/2 13:00', '2009/9/2 14:00', '2009/9/2 15:00', '2009/9/2 16:00', '2009/9/2 17:00', '2009/9/2 18:00', '2009/9/2 19:00', '2009/9/2 20:00', '2009/9/2 21:00', '2009/9/2 22:00', '2009/9/2 23:00', '2009/9/3 0:00', '2009/9/3 1:00', '2009/9/3 2:00', '2009/9/3 3:00', '2009/9/3 4:00', '2009/9/3 5:00', '2009/9/3 6:00', '2009/9/3 7:00', '2009/9/3 8:00', '2009/9/3 9:00', '2009/9/3 10:00', '2009/9/3 11:00', '2009/9/3 12:00', '2009/9/3 13:00', '2009/9/3 14:00', '2009/9/3 15:00', '2009/9/3 16:00', '2009/9/3 17:00', '2009/9/3 18:00', '2009/9/3 19:00', '2009/9/3 20:00', '2009/9/3 21:00', '2009/9/3 22:00', '2009/9/3 23:00', '2009/9/4 0:00', '2009/9/4 1:00', '2009/9/4 2:00', '2009/9/4 3:00', '2009/9/4 4:00', '2009/9/4 5:00', '2009/9/4 6:00', '2009/9/4 7:00', '2009/9/4 8:00', '2009/9/4 9:00', '2009/9/4 10:00', '2009/9/4 11:00', '2009/9/4 12:00', '2009/9/4 13:00', '2009/9/4 14:00', '2009/9/4 15:00', '2009/9/4 16:00', '2009/9/4 17:00', '2009/9/4 18:00', '2009/9/4 19:00', '2009/9/4 20:00', '2009/9/4 21:00', '2009/9/4 22:00', '2009/9/4 23:00', '2009/9/5 0:00', '2009/9/5 1:00', '2009/9/5 2:00', '2009/9/5 3:00', '2009/9/5 4:00', '2009/9/5 5:00', '2009/9/5 6:00', '2009/9/5 7:00', '2009/9/5 8:00', '2009/9/5 9:00', '2009/9/5 10:00', '2009/9/5 11:00', '2009/9/5 12:00', '2009/9/5 13:00', '2009/9/5 14:00', '2009/9/5 15:00', '2009/9/5 16:00', '2009/9/5 17:00', '2009/9/5 18:00', '2009/9/5 19:00', '2009/9/5 20:00', '2009/9/5 21:00', '2009/9/5 22:00', '2009/9/5 23:00', '2009/9/6 0:00', '2009/9/6 1:00', '2009/9/6 2:00', '2009/9/6 3:00', '2009/9/6 4:00', '2009/9/6 5:00', '2009/9/6 6:00', '2009/9/6 7:00', '2009/9/6 8:00', '2009/9/6 9:00', '2009/9/6 10:00', '2009/9/6 11:00', '2009/9/6 12:00', '2009/9/6 13:00', '2009/9/6 14:00', '2009/9/6 15:00', '2009/9/6 16:00', '2009/9/6 17:00', '2009/9/6 18:00', '2009/9/6 19:00', '2009/9/6 20:00', '2009/9/6 21:00', '2009/9/6 22:00', '2009/9/6 23:00', '2009/9/7 0:00', '2009/9/7 1:00', '2009/9/7 2:00', '2009/9/7 3:00', '2009/9/7 4:00', '2009/9/7 5:00', '2009/9/7 6:00', '2009/9/7 7:00', '2009/9/7 8:00', '2009/9/7 9:00', '2009/9/7 10:00', '2009/9/7 11:00', '2009/9/7 12:00', '2009/9/7 13:00', '2009/9/7 14:00', '2009/9/7 15:00', '2009/9/7 16:00', '2009/9/7 17:00', '2009/9/7 18:00', '2009/9/7 19:00', '2009/9/7 20:00', '2009/9/7 21:00', '2009/9/7 22:00', '2009/9/7 23:00', '2009/9/8 0:00', '2009/9/8 1:00', '2009/9/8 2:00', '2009/9/8 3:00', '2009/9/8 4:00', '2009/9/8 5:00', '2009/9/8 6:00', '2009/9/8 7:00', '2009/9/8 8:00', '2009/9/8 9:00', '2009/9/8 10:00', '2009/9/8 11:00', '2009/9/8 12:00', '2009/9/8 13:00', '2009/9/8 14:00', '2009/9/8 15:00', '2009/9/8 16:00', '2009/9/8 17:00', '2009/9/8 18:00', '2009/9/8 19:00', '2009/9/8 20:00', '2009/9/8 21:00', '2009/9/8 22:00', '2009/9/8 23:00', '2009/9/9 0:00', '2009/9/9 1:00', '2009/9/9 2:00', '2009/9/9 3:00', '2009/9/9 4:00', '2009/9/9 5:00', '2009/9/9 6:00', '2009/9/9 7:00', '2009/9/9 8:00', '2009/9/9 9:00', '2009/9/9 10:00', '2009/9/9 11:00', '2009/9/9 12:00', '2009/9/9 13:00', '2009/9/9 14:00', '2009/9/9 15:00', '2009/9/9 16:00', '2009/9/9 17:00', '2009/9/9 18:00', '2009/9/9 19:00', '2009/9/9 20:00', '2009/9/9 21:00', '2009/9/9 22:00', '2009/9/9 23:00', '2009/9/10 0:00', '2009/9/10 1:00', '2009/9/10 2:00', '2009/9/10 3:00', '2009/9/10 4:00', '2009/9/10 5:00', '2009/9/10 6:00', '2009/9/10 7:00', '2009/9/10 8:00', '2009/9/10 9:00', '2009/9/10 10:00', '2009/9/10 11:00', '2009/9/10 12:00', '2009/9/10 13:00', '2009/9/10 14:00', '2009/9/10 15:00', '2009/9/10 16:00', '2009/9/10 17:00', '2009/9/10 18:00', '2009/9/10 19:00', '2009/9/10 20:00', '2009/9/10 21:00', '2009/9/10 22:00', '2009/9/10 23:00', '2009/9/11 0:00', '2009/9/11 1:00', '2009/9/11 2:00', '2009/9/11 3:00', '2009/9/11 4:00', '2009/9/11 5:00', '2009/9/11 6:00', '2009/9/11 7:00', '2009/9/11 8:00', '2009/9/11 9:00', '2009/9/11 10:00', '2009/9/11 11:00', '2009/9/11 12:00', '2009/9/11 13:00', '2009/9/11 14:00', '2009/9/11 15:00', '2009/9/11 16:00', '2009/9/11 17:00', '2009/9/11 18:00', '2009/9/11 19:00', '2009/9/11 20:00', '2009/9/11 21:00', '2009/9/11 22:00', '2009/9/11 23:00', '2009/9/12 0:00', '2009/9/12 1:00', '2009/9/12 2:00', '2009/9/12 3:00', '2009/9/12 4:00', '2009/9/12 5:00', '2009/9/12 6:00', '2009/9/12 7:00', '2009/9/12 8:00', '2009/9/12 9:00', '2009/9/12 10:00', '2009/9/12 11:00', '2009/9/12 12:00', '2009/9/12 13:00', '2009/9/12 14:00', '2009/9/12 15:00', '2009/9/12 16:00', '2009/9/12 17:00', '2009/9/12 18:00', '2009/9/12 19:00', '2009/9/12 20:00', '2009/9/12 21:00', '2009/9/12 22:00', '2009/9/12 23:00', '2009/9/13 0:00', '2009/9/13 1:00', '2009/9/13 2:00', '2009/9/13 3:00', '2009/9/13 4:00', '2009/9/13 5:00', '2009/9/13 6:00', '2009/9/13 7:00', '2009/9/13 8:00', '2009/9/13 9:00', '2009/9/13 10:00', '2009/9/13 11:00', '2009/9/13 12:00', '2009/9/13 13:00', '2009/9/13 14:00', '2009/9/13 15:00', '2009/9/13 16:00', '2009/9/13 17:00', '2009/9/13 18:00', '2009/9/13 19:00', '2009/9/13 20:00', '2009/9/13 21:00', '2009/9/13 22:00', '2009/9/13 23:00', '2009/9/14 0:00', '2009/9/14 1:00', '2009/9/14 2:00', '2009/9/14 3:00', '2009/9/14 4:00', '2009/9/14 5:00', '2009/9/14 6:00', '2009/9/14 7:00', '2009/9/14 8:00', '2009/9/14 9:00', '2009/9/14 10:00', '2009/9/14 11:00', '2009/9/14 12:00', '2009/9/14 13:00', '2009/9/14 14:00', '2009/9/14 15:00', '2009/9/14 16:00', '2009/9/14 17:00', '2009/9/14 18:00', '2009/9/14 19:00', '2009/9/14 20:00', '2009/9/14 21:00', '2009/9/14 22:00', '2009/9/14 23:00', '2009/9/15 0:00', '2009/9/15 1:00', '2009/9/15 2:00', '2009/9/15 3:00', '2009/9/15 4:00', '2009/9/15 5:00', '2009/9/15 6:00', '2009/9/15 7:00', '2009/9/15 8:00', '2009/9/15 9:00', '2009/9/15 10:00', '2009/9/15 11:00', '2009/9/15 12:00', '2009/9/15 13:00', '2009/9/15 14:00', '2009/9/15 15:00', '2009/9/15 16:00', '2009/9/15 17:00', '2009/9/15 18:00', '2009/9/15 19:00', '2009/9/15 20:00', '2009/9/15 21:00', '2009/9/15 22:00', '2009/9/15 23:00', '2009/9/16 0:00', '2009/9/16 1:00', '2009/9/16 2:00', '2009/9/16 3:00', '2009/9/16 4:00', '2009/9/16 5:00', '2009/9/16 6:00', '2009/9/16 7:00', '2009/9/16 8:00', '2009/9/16 9:00', '2009/9/16 10:00', '2009/9/16 11:00', '2009/9/16 12:00', '2009/9/16 13:00', '2009/9/16 14:00', '2009/9/16 15:00', '2009/9/16 16:00', '2009/9/16 17:00', '2009/9/16 18:00', '2009/9/16 19:00', '2009/9/16 20:00', '2009/9/16 21:00', '2009/9/16 22:00', '2009/9/16 23:00', '2009/9/17 0:00', '2009/9/17 1:00', '2009/9/17 2:00', '2009/9/17 3:00', '2009/9/17 4:00', '2009/9/17 5:00', '2009/9/17 6:00', '2009/9/17 7:00', '2009/9/17 8:00', '2009/9/17 9:00', '2009/9/17 10:00', '2009/9/17 11:00', '2009/9/17 12:00', '2009/9/17 13:00', '2009/9/17 14:00', '2009/9/17 15:00', '2009/9/17 16:00', '2009/9/17 17:00', '2009/9/17 18:00', '2009/9/17 19:00', '2009/9/17 20:00', '2009/9/17 21:00', '2009/9/17 22:00', '2009/9/17 23:00', '2009/9/18 0:00', '2009/9/18 1:00', '2009/9/18 2:00', '2009/9/18 3:00', '2009/9/18 4:00', '2009/9/18 5:00', '2009/9/18 6:00', '2009/9/18 7:00', '2009/9/18 8:00', '2009/9/18 9:00', '2009/9/18 10:00', '2009/9/18 11:00', '2009/9/18 12:00', '2009/9/18 13:00', '2009/9/18 14:00', '2009/9/18 15:00', '2009/9/18 16:00', '2009/9/18 17:00', '2009/9/18 18:00', '2009/9/18 19:00', '2009/9/18 20:00', '2009/9/18 21:00', '2009/9/18 22:00', '2009/9/18 23:00', '2009/9/19 0:00', '2009/9/19 1:00', '2009/9/19 2:00', '2009/9/19 3:00', '2009/9/19 4:00', '2009/9/19 5:00', '2009/9/19 6:00', '2009/9/19 7:00', '2009/9/19 8:00', '2009/9/19 9:00', '2009/9/19 10:00', '2009/9/19 11:00', '2009/9/19 12:00', '2009/9/19 13:00', '2009/9/19 14:00', '2009/9/19 15:00', '2009/9/19 16:00', '2009/9/19 17:00', '2009/9/19 18:00', '2009/9/19 19:00', '2009/9/19 20:00', '2009/9/19 21:00', '2009/9/19 22:00', '2009/9/19 23:00', '2009/9/20 0:00', '2009/9/20 1:00', '2009/9/20 2:00', '2009/9/20 3:00', '2009/9/20 4:00', '2009/9/20 5:00', '2009/9/20 6:00', '2009/9/20 7:00', '2009/9/20 8:00', '2009/9/20 9:00', '2009/9/20 10:00', '2009/9/20 11:00', '2009/9/20 12:00', '2009/9/20 13:00', '2009/9/20 14:00', '2009/9/20 15:00', '2009/9/20 16:00', '2009/9/20 17:00', '2009/9/20 18:00', '2009/9/20 19:00', '2009/9/20 20:00', '2009/9/20 21:00', '2009/9/20 22:00', '2009/9/20 23:00', '2009/9/21 0:00', '2009/9/21 1:00', '2009/9/21 2:00', '2009/9/21 3:00', '2009/9/21 4:00', '2009/9/21 5:00', '2009/9/21 6:00', '2009/9/21 7:00', '2009/9/21 8:00', '2009/9/21 9:00', '2009/9/21 10:00', '2009/9/21 11:00', '2009/9/21 12:00', '2009/9/21 13:00', '2009/9/21 14:00', '2009/9/21 15:00', '2009/9/21 16:00', '2009/9/21 17:00', '2009/9/21 18:00', '2009/9/21 19:00', '2009/9/21 20:00', '2009/9/21 21:00', '2009/9/21 22:00', '2009/9/21 23:00', '2009/9/22 0:00', '2009/9/22 1:00', '2009/9/22 2:00', '2009/9/22 3:00', '2009/9/22 4:00', '2009/9/22 5:00', '2009/9/22 6:00', '2009/9/22 7:00', '2009/9/22 8:00', '2009/9/22 9:00', '2009/9/22 10:00', '2009/9/22 11:00', '2009/9/22 12:00', '2009/9/22 13:00', '2009/9/22 14:00', '2009/9/22 15:00', '2009/9/22 16:00', '2009/9/22 17:00', '2009/9/22 18:00', '2009/9/22 19:00', '2009/9/22 20:00', '2009/9/22 21:00', '2009/9/22 22:00', '2009/9/22 23:00', '2009/9/23 0:00', '2009/9/23 1:00', '2009/9/23 2:00', '2009/9/23 3:00', '2009/9/23 4:00', '2009/9/23 5:00', '2009/9/23 6:00', '2009/9/23 7:00', '2009/9/23 8:00', '2009/9/23 9:00', '2009/9/23 10:00', '2009/9/23 11:00', '2009/9/23 12:00', '2009/9/23 13:00', '2009/9/23 14:00', '2009/9/23 15:00', '2009/9/23 16:00', '2009/9/23 17:00', '2009/9/23 18:00', '2009/9/23 19:00', '2009/9/23 20:00', '2009/9/23 21:00', '2009/9/23 22:00', '2009/9/23 23:00', '2009/9/24 0:00', '2009/9/24 1:00', '2009/9/24 2:00', '2009/9/24 3:00', '2009/9/24 4:00', '2009/9/24 5:00', '2009/9/24 6:00', '2009/9/24 7:00', '2009/9/24 8:00', '2009/9/24 9:00', '2009/9/24 10:00', '2009/9/24 11:00', '2009/9/24 12:00', '2009/9/24 13:00', '2009/9/24 14:00', '2009/9/24 15:00', '2009/9/24 16:00', '2009/9/24 17:00', '2009/9/24 18:00', '2009/9/24 19:00', '2009/9/24 20:00', '2009/9/24 21:00', '2009/9/24 22:00', '2009/9/24 23:00', '2009/9/25 0:00', '2009/9/25 1:00', '2009/9/25 2:00', '2009/9/25 3:00', '2009/9/25 4:00', '2009/9/25 5:00', '2009/9/25 6:00', '2009/9/25 7:00', '2009/9/25 8:00', '2009/9/25 9:00', '2009/9/25 10:00', '2009/9/25 11:00', '2009/9/25 12:00', '2009/9/25 13:00', '2009/9/25 14:00', '2009/9/25 15:00', '2009/9/25 16:00', '2009/9/25 17:00', '2009/9/25 18:00', '2009/9/25 19:00', '2009/9/25 20:00', '2009/9/25 21:00', '2009/9/25 22:00', '2009/9/25 23:00', '2009/9/26 0:00', '2009/9/26 1:00', '2009/9/26 2:00', '2009/9/26 3:00', '2009/9/26 4:00', '2009/9/26 5:00', '2009/9/26 6:00', '2009/9/26 7:00', '2009/9/26 8:00', '2009/9/26 9:00', '2009/9/26 10:00', '2009/9/26 11:00', '2009/9/26 12:00', '2009/9/26 13:00', '2009/9/26 14:00', '2009/9/26 15:00', '2009/9/26 16:00', '2009/9/26 17:00', '2009/9/26 18:00', '2009/9/26 19:00', '2009/9/26 20:00', '2009/9/26 21:00', '2009/9/26 22:00', '2009/9/26 23:00', '2009/9/27 0:00', '2009/9/27 1:00', '2009/9/27 2:00', '2009/9/27 3:00', '2009/9/27 4:00', '2009/9/27 5:00', '2009/9/27 6:00', '2009/9/27 7:00', '2009/9/27 8:00', '2009/9/27 9:00', '2009/9/27 10:00', '2009/9/27 11:00', '2009/9/27 12:00', '2009/9/27 13:00', '2009/9/27 14:00', '2009/9/27 15:00', '2009/9/27 16:00', '2009/9/27 17:00', '2009/9/27 18:00', '2009/9/27 19:00', '2009/9/27 20:00', '2009/9/27 21:00', '2009/9/27 22:00', '2009/9/27 23:00', '2009/9/28 0:00', '2009/9/28 1:00', '2009/9/28 2:00', '2009/9/28 3:00', '2009/9/28 4:00', '2009/9/28 5:00', '2009/9/28 6:00', '2009/9/28 7:00', '2009/9/28 8:00', '2009/9/28 9:00', '2009/9/28 10:00', '2009/9/28 11:00', '2009/9/28 12:00', '2009/9/28 13:00', '2009/9/28 14:00', '2009/9/28 15:00', '2009/9/28 16:00', '2009/9/28 17:00', '2009/9/28 18:00', '2009/9/28 19:00', '2009/9/28 20:00', '2009/9/28 21:00', '2009/9/28 22:00', '2009/9/28 23:00', '2009/9/29 0:00', '2009/9/29 1:00', '2009/9/29 2:00', '2009/9/29 3:00', '2009/9/29 4:00', '2009/9/29 5:00', '2009/9/29 6:00', '2009/9/29 7:00', '2009/9/29 8:00', '2009/9/29 9:00', '2009/9/29 10:00', '2009/9/29 11:00', '2009/9/29 12:00', '2009/9/29 13:00', '2009/9/29 14:00', '2009/9/29 15:00', '2009/9/29 16:00', '2009/9/29 17:00', '2009/9/29 18:00', '2009/9/29 19:00', '2009/9/29 20:00', '2009/9/29 21:00', '2009/9/29 22:00', '2009/9/29 23:00', '2009/9/30 0:00', '2009/9/30 1:00', '2009/9/30 2:00', '2009/9/30 3:00', '2009/9/30 4:00', '2009/9/30 5:00', '2009/9/30 6:00', '2009/9/30 7:00', '2009/9/30 8:00', '2009/9/30 9:00', '2009/9/30 10:00', '2009/9/30 11:00', '2009/9/30 12:00', '2009/9/30 13:00', '2009/9/30 14:00', '2009/9/30 15:00', '2009/9/30 16:00', '2009/9/30 17:00', '2009/9/30 18:00', '2009/9/30 19:00', '2009/9/30 20:00', '2009/9/30 21:00', '2009/9/30 22:00', '2009/9/30 23:00',
                '2009/10/1 0:00', '2009/10/1 1:00', '2009/10/1 2:00', '2009/10/1 3:00', '2009/10/1 4:00', '2009/10/1 5:00', '2009/10/1 6:00', '2009/10/1 7:00', '2009/10/1 8:00', '2009/10/1 9:00', '2009/10/1 10:00', '2009/10/1 11:00', '2009/10/1 12:00', '2009/10/1 13:00', '2009/10/1 14:00', '2009/10/1 15:00', '2009/10/1 16:00', '2009/10/1 17:00', '2009/10/1 18:00', '2009/10/1 19:00', '2009/10/1 20:00', '2009/10/1 21:00', '2009/10/1 22:00', '2009/10/1 23:00', '2009/10/2 0:00', '2009/10/2 1:00', '2009/10/2 2:00', '2009/10/2 3:00', '2009/10/2 4:00', '2009/10/2 5:00', '2009/10/2 6:00', '2009/10/2 7:00', '2009/10/2 8:00', '2009/10/2 9:00', '2009/10/2 10:00', '2009/10/2 11:00', '2009/10/2 12:00', '2009/10/2 13:00', '2009/10/2 14:00', '2009/10/2 15:00', '2009/10/2 16:00', '2009/10/2 17:00', '2009/10/2 18:00', '2009/10/2 19:00', '2009/10/2 20:00', '2009/10/2 21:00', '2009/10/2 22:00', '2009/10/2 23:00', '2009/10/3 0:00', '2009/10/3 1:00', '2009/10/3 2:00', '2009/10/3 3:00', '2009/10/3 4:00', '2009/10/3 5:00', '2009/10/3 6:00', '2009/10/3 7:00', '2009/10/3 8:00', '2009/10/3 9:00', '2009/10/3 10:00', '2009/10/3 11:00', '2009/10/3 12:00', '2009/10/3 13:00', '2009/10/3 14:00', '2009/10/3 15:00', '2009/10/3 16:00', '2009/10/3 17:00', '2009/10/3 18:00', '2009/10/3 19:00', '2009/10/3 20:00', '2009/10/3 21:00', '2009/10/3 22:00', '2009/10/3 23:00', '2009/10/4 0:00', '2009/10/4 1:00', '2009/10/4 2:00', '2009/10/4 3:00', '2009/10/4 4:00', '2009/10/4 5:00', '2009/10/4 6:00', '2009/10/4 7:00', '2009/10/4 8:00', '2009/10/4 9:00', '2009/10/4 10:00', '2009/10/4 11:00', '2009/10/4 12:00', '2009/10/4 13:00', '2009/10/4 14:00', '2009/10/4 15:00', '2009/10/4 16:00', '2009/10/4 17:00', '2009/10/4 18:00', '2009/10/4 19:00', '2009/10/4 20:00', '2009/10/4 21:00', '2009/10/4 22:00', '2009/10/4 23:00', '2009/10/5 0:00', '2009/10/5 1:00', '2009/10/5 2:00', '2009/10/5 3:00', '2009/10/5 4:00', '2009/10/5 5:00', '2009/10/5 6:00', '2009/10/5 7:00', '2009/10/5 8:00', '2009/10/5 9:00', '2009/10/5 10:00', '2009/10/5 11:00', '2009/10/5 12:00', '2009/10/5 13:00', '2009/10/5 14:00', '2009/10/5 15:00', '2009/10/5 16:00', '2009/10/5 17:00', '2009/10/5 18:00', '2009/10/5 19:00', '2009/10/5 20:00', '2009/10/5 21:00', '2009/10/5 22:00', '2009/10/5 23:00', '2009/10/6 0:00', '2009/10/6 1:00', '2009/10/6 2:00', '2009/10/6 3:00', '2009/10/6 4:00', '2009/10/6 5:00', '2009/10/6 6:00', '2009/10/6 7:00', '2009/10/6 8:00', '2009/10/6 9:00', '2009/10/6 10:00', '2009/10/6 11:00', '2009/10/6 12:00', '2009/10/6 13:00', '2009/10/6 14:00', '2009/10/6 15:00', '2009/10/6 16:00', '2009/10/6 17:00', '2009/10/6 18:00', '2009/10/6 19:00', '2009/10/6 20:00', '2009/10/6 21:00', '2009/10/6 22:00', '2009/10/6 23:00', '2009/10/7 0:00', '2009/10/7 1:00', '2009/10/7 2:00', '2009/10/7 3:00', '2009/10/7 4:00', '2009/10/7 5:00', '2009/10/7 6:00', '2009/10/7 7:00', '2009/10/7 8:00', '2009/10/7 9:00', '2009/10/7 10:00', '2009/10/7 11:00', '2009/10/7 12:00', '2009/10/7 13:00', '2009/10/7 14:00', '2009/10/7 15:00', '2009/10/7 16:00', '2009/10/7 17:00', '2009/10/7 18:00', '2009/10/7 19:00', '2009/10/7 20:00', '2009/10/7 21:00', '2009/10/7 22:00', '2009/10/7 23:00', '2009/10/8 0:00', '2009/10/8 1:00', '2009/10/8 2:00', '2009/10/8 3:00', '2009/10/8 4:00', '2009/10/8 5:00', '2009/10/8 6:00', '2009/10/8 7:00', '2009/10/8 8:00', '2009/10/8 9:00', '2009/10/8 10:00', '2009/10/8 11:00', '2009/10/8 12:00', '2009/10/8 13:00', '2009/10/8 14:00', '2009/10/8 15:00', '2009/10/8 16:00', '2009/10/8 17:00', '2009/10/8 18:00', '2009/10/8 19:00', '2009/10/8 20:00', '2009/10/8 21:00', '2009/10/8 22:00', '2009/10/8 23:00', '2009/10/9 0:00', '2009/10/9 1:00', '2009/10/9 2:00', '2009/10/9 3:00', '2009/10/9 4:00', '2009/10/9 5:00', '2009/10/9 6:00', '2009/10/9 7:00', '2009/10/9 8:00', '2009/10/9 9:00', '2009/10/9 10:00', '2009/10/9 11:00', '2009/10/9 12:00', '2009/10/9 13:00', '2009/10/9 14:00', '2009/10/9 15:00', '2009/10/9 16:00', '2009/10/9 17:00', '2009/10/9 18:00', '2009/10/9 19:00', '2009/10/9 20:00', '2009/10/9 21:00', '2009/10/9 22:00', '2009/10/9 23:00', '2009/10/10 0:00', '2009/10/10 1:00', '2009/10/10 2:00', '2009/10/10 3:00', '2009/10/10 4:00', '2009/10/10 5:00', '2009/10/10 6:00', '2009/10/10 7:00', '2009/10/10 8:00', '2009/10/10 9:00', '2009/10/10 10:00', '2009/10/10 11:00', '2009/10/10 12:00', '2009/10/10 13:00', '2009/10/10 14:00', '2009/10/10 15:00', '2009/10/10 16:00', '2009/10/10 17:00', '2009/10/10 18:00', '2009/10/10 19:00', '2009/10/10 20:00', '2009/10/10 21:00', '2009/10/10 22:00', '2009/10/10 23:00', '2009/10/11 0:00', '2009/10/11 1:00', '2009/10/11 2:00', '2009/10/11 3:00', '2009/10/11 4:00', '2009/10/11 5:00', '2009/10/11 6:00', '2009/10/11 7:00', '2009/10/11 8:00', '2009/10/11 9:00', '2009/10/11 10:00', '2009/10/11 11:00', '2009/10/11 12:00', '2009/10/11 13:00', '2009/10/11 14:00', '2009/10/11 15:00', '2009/10/11 16:00', '2009/10/11 17:00', '2009/10/11 18:00', '2009/10/11 19:00', '2009/10/11 20:00', '2009/10/11 21:00', '2009/10/11 22:00', '2009/10/11 23:00', '2009/10/12 0:00', '2009/10/12 1:00', '2009/10/12 2:00', '2009/10/12 3:00', '2009/10/12 4:00', '2009/10/12 5:00', '2009/10/12 6:00', '2009/10/12 7:00', '2009/10/12 8:00', '2009/10/12 9:00', '2009/10/12 10:00', '2009/10/12 11:00', '2009/10/12 12:00', '2009/10/12 13:00', '2009/10/12 14:00', '2009/10/12 15:00', '2009/10/12 16:00', '2009/10/12 17:00', '2009/10/12 18:00', '2009/10/12 19:00', '2009/10/12 20:00', '2009/10/12 21:00', '2009/10/12 22:00', '2009/10/12 23:00', '2009/10/13 0:00', '2009/10/13 1:00', '2009/10/13 2:00', '2009/10/13 3:00', '2009/10/13 4:00', '2009/10/13 5:00', '2009/10/13 6:00', '2009/10/13 7:00', '2009/10/13 8:00', '2009/10/13 9:00', '2009/10/13 10:00', '2009/10/13 11:00', '2009/10/13 12:00', '2009/10/13 13:00', '2009/10/13 14:00', '2009/10/13 15:00', '2009/10/13 16:00', '2009/10/13 17:00', '2009/10/13 18:00', '2009/10/13 19:00', '2009/10/13 20:00', '2009/10/13 21:00', '2009/10/13 22:00', '2009/10/13 23:00', '2009/10/14 0:00', '2009/10/14 1:00', '2009/10/14 2:00', '2009/10/14 3:00', '2009/10/14 4:00', '2009/10/14 5:00', '2009/10/14 6:00', '2009/10/14 7:00', '2009/10/14 8:00', '2009/10/14 9:00', '2009/10/14 10:00', '2009/10/14 11:00', '2009/10/14 12:00', '2009/10/14 13:00', '2009/10/14 14:00', '2009/10/14 15:00', '2009/10/14 16:00', '2009/10/14 17:00', '2009/10/14 18:00', '2009/10/14 19:00', '2009/10/14 20:00', '2009/10/14 21:00', '2009/10/14 22:00', '2009/10/14 23:00', '2009/10/15 0:00', '2009/10/15 1:00', '2009/10/15 2:00', '2009/10/15 3:00', '2009/10/15 4:00', '2009/10/15 5:00', '2009/10/15 6:00', '2009/10/15 7:00', '2009/10/15 8:00', '2009/10/15 9:00', '2009/10/15 10:00', '2009/10/15 11:00', '2009/10/15 12:00', '2009/10/15 13:00', '2009/10/15 14:00', '2009/10/15 15:00', '2009/10/15 16:00', '2009/10/15 17:00', '2009/10/15 18:00', '2009/10/15 19:00', '2009/10/15 20:00', '2009/10/15 21:00', '2009/10/15 22:00', '2009/10/15 23:00', '2009/10/16 0:00', '2009/10/16 1:00', '2009/10/16 2:00', '2009/10/16 3:00', '2009/10/16 4:00', '2009/10/16 5:00', '2009/10/16 6:00', '2009/10/16 7:00', '2009/10/16 8:00', '2009/10/16 9:00', '2009/10/16 10:00', '2009/10/16 11:00', '2009/10/16 12:00', '2009/10/16 13:00', '2009/10/16 14:00', '2009/10/16 15:00', '2009/10/16 16:00', '2009/10/16 17:00', '2009/10/16 18:00', '2009/10/16 19:00', '2009/10/16 20:00', '2009/10/16 21:00', '2009/10/16 22:00', '2009/10/16 23:00', '2009/10/17 0:00', '2009/10/17 1:00', '2009/10/17 2:00', '2009/10/17 3:00', '2009/10/17 4:00', '2009/10/17 5:00', '2009/10/17 6:00', '2009/10/17 7:00', '2009/10/17 8:00', '2009/10/17 9:00', '2009/10/17 10:00', '2009/10/17 11:00', '2009/10/17 12:00', '2009/10/17 13:00', '2009/10/17 14:00', '2009/10/17 15:00', '2009/10/17 16:00', '2009/10/17 17:00', '2009/10/17 18:00', '2009/10/17 19:00', '2009/10/17 20:00', '2009/10/17 21:00', '2009/10/17 22:00', '2009/10/17 23:00', '2009/10/18 0:00', '2009/10/18 1:00', '2009/10/18 2:00', '2009/10/18 3:00', '2009/10/18 4:00', '2009/10/18 5:00', '2009/10/18 6:00', '2009/10/18 7:00', '2009/10/18 8:00'
            ];

            timeData = timeData.map(function (str) {
                return str.replace('2009/', '');
            });

            var options = {
                title: {
                    text: '雨量流量关系图',
                    subtext: '数据来自西安兰特水电测控技术有限公司',
                    x: 'center'
                },
                tooltip: {
                    trigger: 'axis',
                    axisPointer: {
                        animation: false
                    }
                },
                legend: {
                    data:['流量','降雨量'],
                    x: 'left'
                },
                toolbox: {
                    feature: {
                        dataZoom: {
                            yAxisIndex: 'none'
                        },
                        restore: {},
                        saveAsImage: {}
                    }
                },
                dataZoom: [
                    {
                        show: true,
                        realtime: true,
                        start: 30,
                        end: 70,
                        xAxisIndex: [0, 1]
                    },
                    {
                        type: 'inside',
                        realtime: true,
                        start: 30,
                        end: 70,
                        xAxisIndex: [0, 1]
                    }
                ],
                grid: [{
                    left: 50,
                    right: 50,
                    height: '35%'
                }, {
                    left: 50,
                    right: 50,
                    top: '55%',
                    height: '35%'
                }],
                xAxis : [
                    {
                        type : 'category',
                        boundaryGap : false,
                        axisLine: {onZero: true},
                        data: timeData
                    },
                    {
                        gridIndex: 1,
                        type : 'category',
                        boundaryGap : false,
                        axisLine: {onZero: true},
                        data: timeData,
                        position: 'top'
                    }
                ],
                yAxis : [
                    {
                        name : '流量(m^3/s)',
                        type : 'value',
                        max : 500
                    },
                    {
                        gridIndex: 1,
                        name : '降雨量(mm)',
                        type : 'value',
                        inverse: true
                    }
                ],
                series : [
                    {
                        name:'流量',
                        type:'line',
                        symbolSize: 8,
                        hoverAnimation: false,
                        data:[
                            0.97,0.96,0.96,0.95,0.95,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.93,0.92,0.91,0.9,0.89,0.88,0.87,0.87,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.87,0.88,0.9,0.93,0.96,0.99,1.03,1.06,1.1,1.14,1.17,1.2,1.23,1.26,1.29,1.33,1.36,1.4,1.43,1.45,1.48,1.49,1.51,1.51,1.5,1.49,1.47,1.44,1.41,1.37,1.34,1.3,1.27,1.24,1.22,1.2,1.19,1.18,1.16,1.15,1.14,1.13,1.12,1.11,1.11,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.09,1.09,1.08,1.07,1.06,1.05,1.04,1.03,1.03,1.02,1.01,1.01,1,0.99,0.98,0.97,0.96,0.96,0.95,0.95,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.93,0.92,0.91,0.9,0.89,0.88,0.87,0.87,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.85,0.84,0.83,0.82,0.81,0.8,0.8,0.79,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.77,0.75,0.73,0.71,0.68,0.65,0.63,0.61,0.59,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.57,0.57,0.57,0.56,0.55,0.55,0.54,0.54,0.53,0.52,0.52,0.51,0.51,0.5,0.5,0.49,0.48,0.48,0.47,0.47,0.47,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.46,0.52,0.67,0.9,1.19,1.52,1.87,2.22,2.55,2.84,3.07,3.22,3.28,3.28,3.28,3.28,3.28,3.28,3.28,3.28,3.28,3.28,3.28,3.28,3.28,3.24,3.13,2.97,2.77,2.54,2.3,2.05,1.82,1.62,1.46,1.35,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.31,1.3,1.26,1.21,1.14,1.06,0.97,0.89,0.81,0.74,0.69,0.65,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.63,0.63,0.62,0.62,0.61,0.6,0.59,0.59,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.59,0.61,0.63,0.65,0.68,0.71,0.73,0.75,0.77,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.77,0.75,0.73,0.71,0.68,0.65,0.63,0.61,0.59,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.58,0.59,0.59,0.6,0.61,0.62,0.62,0.63,0.63,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.65,0.66,0.68,0.69,0.71,0.73,0.74,0.76,0.77,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.79,0.81,0.82,0.84,0.86,0.88,0.9,0.92,0.93,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.94,0.93,0.92,0.91,0.9,0.89,0.88,0.87,0.87,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.86,0.85,0.84,0.82,0.8,0.78,0.76,0.75,0.73,0.72,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.72,0.73,0.74,0.76,0.78,0.79,0.82,0.84,0.86,0.89,0.91,0.94,0.97,1,1.02,1.05,1.08,1.11,1.14,1.17,1.19,1.22,1.25,1.27,1.29,1.31,1.33,1.35,1.36,1.38,1.39,1.39,1.4,1.4,1.4,1.39,1.37,1.35,1.32,1.29,1.26,1.22,1.18,1.14,1.1,1.05,1.01,0.97,0.93,0.89,0.85,0.82,0.78,0.76,0.74,0.72,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.72,0.73,0.74,0.75,0.77,0.78,0.8,0.82,0.84,0.87,0.89,0.92,0.94,0.97,0.99,1.02,1.05,1.08,1.1,1.13,1.16,1.18,1.21,1.23,1.26,1.28,1.3,1.32,1.34,1.35,1.37,1.38,1.39,1.4,1.41,1.41,1.42,1.42,1.43,1.43,1.43,1.44,1.44,1.44,1.44,1.45,1.45,1.45,1.46,1.46,1.46,1.47,1.47,1.48,1.48,1.49,1.5,1.51,1.54,1.62,1.73,1.88,2.05,2.24,2.45,2.67,2.89,3.11,3.31,3.51,3.69,3.86,4.03,4.18,4.33,4.48,4.62,4.76,4.89,5.02,5.16,5.29,5.43,5.57,5.71,5.86,6.02,6.18,6.36,6.54,6.73,6.93,7.15,7.38,7.62,7.88,8.16,8.46,8.77,9.11,9.46,9.84,10.24,10.67,11.12,11.6,12.3,13.66,16,38.43,82.21,146.6,218.7,226,225.23,223.08,219.78,212,199.82,184.6,168,151.65,137.21,126.31,119.94,115.52,112.06,108.92,105.44,101,94.56,86.36,77.67,69.76,63.9,60.38,57.41,54.84,52.57,50.56,48.71,46.97,45.25,43.48,41.6,39.5,37.19,34.81,32.46,30.27,28.36,26.85,25.86,25.5,25.5,25.5,25.5,25.5,25.5,25.5,25.5,25.5,25.5,25.5,25.5,25.5,25.27,24.65,23.7,22.52,21.17,19.75,18.33,16.98,15.8,14.85,14.23,14,14.02,14.08,14.17,14.29,14.44,14.61,14.8,15.01,15.23,15.47,15.71,15.95,16.19,16.43,16.67,16.89,17.1,17.29,17.46,17.61,17.73,17.82,17.88,17.9,17.63,16.88,15.75,14.33,12.71,10.98,9.23,7.56,6.05,4.81,3.92,3.47,3.28,3.1,2.93,2.76,2.61,2.46,2.32,2.19,2.07,1.96,1.85,1.75,1.66,1.58,1.51,1.44,1.39,1.34,1.29,1.26,1.23,1.22,1.2,1.2,1.2,1.2,1.2,1.2,1.21,1.21,1.21,1.21,1.22,1.22,1.22,1.23,1.23,1.23,1.24,1.24,1.25,1.25,1.25,1.26,1.26,1.27,1.27,1.27,1.28,1.28,1.28,1.29,1.29,1.29,1.29,1.3,1.3,1.3,1.3,1.3,1.3,1.3,1.3,1.3,1.3,1.3,1.29,1.29,1.29,1.29,1.28,1.28,1.28,1.27,1.27,1.26,1.25,1.25,1.24,1.23,1.23,1.22,1.21,1.2,1.16,1.06,0.95,0.83,0.74,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.71,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.7,0.69,0.69,0.69,0.69,0.69,0.69,0.69,0.69,0.68,0.68,0.68,0.68,0.68,0.68,0.67,0.67,0.67,0.67,0.67,0.67,0.67,0.66,0.66,0.66,0.66,0.66,0.66,0.66,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.65,0.66,0.68,0.69,0.71,0.73,0.74,0.76,0.77,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.78,0.8,0.86,0.95,1.08,1.25,1.46,1.7,1.97,2.28,2.63,3.01,3.42,3.87,4.35,4.86,5.4,5.98,6.59,7.92,10.49,14.04,18.31,23.04,27.98,32.87,37.45,41.46,44.64,46.74,47.5,46.86,45.16,42.77,40.04,37.33,35,32.74,30.21,27.7,25.5,23.9,23.2,23.06,22.94,22.84,22.77,22.72,22.7,22.8,23.23,23.95,24.91,26.04,27.3,28.76,30.7,33.39,37.12,42.15,48.77,65.22,252.1,257,237.32,221.19,212,208.67,206.89,205.2,202.15,189.82,172,165.3,160.49,156.8,153.44,149.62,144.6,138.27,131,123.11,114.9,106.69,98.79,91.5,85.13,80,75.53,71.03,66.65,62.54,58.85,55.73,53.31,51.75,51.2,56.53,68.25,80,91.01,102.03,109,112.37,115.29,117.68,119.48,120.61,121,119.45,115.57,110.52,105.47,101.58,100,99.97,99.94,99.92,99.9,99.88,99.86,99.85,99.84,99.83,99.82,99.81,99.81,99.8,99.8,99.8,122.15,163.65,186,182.96,175.15,164.56,153.18,143,136,131.37,126.98,122.81,118.85,115.09,111.52,108.13,104.9,101.83,98.9,96.11,93.44,90.87,88.41,86.04,83.74,81.51,79.33,77.2,75.1,73.02,70.95,68.88,66.8,64.87,63.14,61.4,59.53,57.67,56,54.6,53.36,52.2,51.05,49.85,48.5,46.87,44.92,42.74,40.42,38.04,35.69,33.46,31.44,29.72,28.38,27.51,27.2,27.2,27.2,27.2,27.2,27.2,27.2,27.2,27.2,27.2,27.2,27.2,27.2,27.14,26.97,26.7,26.35,25.95,25.49,25.02,24.53,24.04,23.58,23.16,22.8,22.46,22.11,21.75,21.39,21.03,20.69,20.36,20.05,19.78,19.54,19.35,19.2,19.09,19,18.92,18.85,18.79,18.74,18.68,18.62,18.56,18.49,18.4,18.3,18.17,18.02,17.83,17.63,17.41,17.18,16.93,16.68,16.43,16.18,15.93,15.7,15.47,15.22,14.97,14.71,14.45,14.18,13.93,13.68,13.44,13.21,13,12.8,12.62,12.46,12.31,12.16,12.03,11.89,11.76,11.62,11.48,11.33,11.17,11,10.81,10.59,10.36,10.12,9.86,9.61,9.36,9.12,8.89,8.68,8.5,8.35,8.21,8.08,7.94,7.81,7.68,7.56,7.46,7.36,7.29,7.23,7.19,7.18,7.51,8.42,9.81,11.58,13.63,15.86,18.16,20.44,22.58,24.49,26.06,27.2,28.08,28.95,29.81,30.65,31.48,32.28,33.07,33.82,34.55,35.25,35.92,36.56,37.15,37.71,38.23,38.7,39.13,39.5,39.83,40.1,40.31,40.47,40.57,40.6,40.49,40.16,39.64,38.94,38.09,37.1,36,34.79,33.51,32.17,30.79,29.39,27.99,26.6,25.25,23.96,22.75,21.63,20.63,19.76,19.04,18.49,18.14,18,17.97,17.95,17.94,17.92,17.91,17.9,17.89,17.88,17.87,17.85,17.83,17.8,17.7,17.46,17.13,16.7,16.21,15.68,15.13,14.57,14.04,13.56,13.14,12.8,12.52,12.27,12.02,11.79,11.57,11.37,11.16,10.97,10.78,10.59,10.39,10.2,10.01,9.81,9.63,9.44,9.26,9.08,8.9,8.73,8.56,8.39,8.22,8.06,7.9,7.73,7.57,7.41,7.25,7.09,6.94,6.79,6.65,6.52,6.4,6.28,6.17,6.08,5.98,5.9,5.81,5.73,5.65,5.57,5.49,5.41,5.32,5.23,5.14,5.04,4.94,4.84,4.74,4.63,4.53,4.43,4.33,4.23,4.13,4.03,3.93,3.81,3.69,3.57,3.45,3.33,3.22,3.12,3.04,2.98,2.93,2.92,2.92,2.92,2.92,2.92,2.92,2.92,2.92,2.92,2.92,2.92,2.92,2.92,2.9,2.86,2.8,2.71,2.62,2.52,2.42,2.33,2.24,2.18,2.14,2.12,2.12,2.12,2.12,2.12,2.12,2.12,2.12,2.12,2.12,2.12,2.12,2.12,2.1,2.06,2,1.91,1.82,1.71,1.61,1.5,1.4,1.32,1.25,1.2,1.16,1.13,1.1,1.06,1.03,1,0.97,0.93,0.9,0.87,0.85,0.82,0.79,0.77,0.74,0.72,0.69,0.67,0.65,0.63,0.61,0.59,0.58,0.56,0.54,0.53,0.52,0.51,0.5,0.49,0.48,0.48,0.47,0.47,0.46,0.46,0.47,0.48,0.5,0.53,0.56,0.59,0.62,0.64,0.67,0.69,0.7,0.71,0.71,0.71,0.71,0.7,0.7,0.7,0.69,0.69,0.69,0.68,0.68,0.67,0.67,0.67,0.66,0.66,0.65,0.65,0.65,0.65,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.64,0.65,0.65,0.65,0.66,0.66,0.67,0.68,0.69,0.69,0.7,0.71,0.73,0.74,0.75,0.76,0.78,0.8,0.81,0.83,0.85,0.87,0.89,0.92,0.94,0.97,0.99,1.02,1.05,1.08,1.11,1.15,1.18,1.32,1.66,2.21,2.97,3.94,5.11,6.5,8.1,9.9,11.92,14.15,16.6,22.3,22.8,24.48,30.38,35.74,42.4,57.14,94.04,112.9,123.4,130.4,130,119.4,120.7,116.8,118.1,119.4,124.8,143.5,204,294,319.2,328.4,365,350.8,347.6,347.6,325,331.6,319.2,308,308,308,308,296.8,300,281,278.4,270.6,271,253.6,233.5,219.2,207.8,205.9,204,189.6,178.8,173.4,160,154.4,146,145,140.5,130.4,126.2,116.8,112.9,106.5,101.6,98.51,82.67,67.3,80.05,76.12,72.3,71.02,69.78,67.3,67.3,68.54,57.6,71.02,66.06,59.12,57.14,55.16,55.16,52.19,52.19,51.2,48.56,44.16,43,45.92,49.44,44.16,36.48,35.74,35,32.36,37.22,32.36,32.36,32.36,33.68,32.36,31.7,35.74,29.72,32.36,30.38,29.72,28.4,28.4,28.4,27.28,25.6,25.04,23.92,22.3,21.8,21.8,21.8,22.8,21.8,25.6,22.8,22.8,17.8,16.04,16.04,16.04,16.04,16.04,16.04,16.04,16.04,16.04,16.04,15.02,14,14.03,14.11,14.25,14.45,14.72,15.06,15.46,15.95,16.51,17.15,17.87,18.69,19.59,20.59,21.69,22.88,24.18,25.59,27.1,28.73,30.48,32.34,34.33,36.44,38.69,41.06,43.57,46.22,49.01,51.95,55.04,58.27,61.66,65.21,68.92,72.8,88.09,104.9,105.7,110.3,111.6,110.3,106.5,105.7,103.3,100,97.02,98.8,91.07,83.98,88.09,81.36,78.74,77.43,77.43,73.5,74.81,72.63,68.58,66.4,68.54,69.78,67.3,64.82,61.1,59.12,56.15,53.18,50.32,49.44,44.16,36.5,42.4,37.96,37.22,33.68,36.48,35.74,35,35,37.22,37.22,39.44,32.6,34.54,36.48,35.74,34.34,33.68,33.02,31.04,29.72,29.72,29.72,26.16,25.6,29.72,18.3,22.3,21.3,21.8,21.8,20.3,20.8,25.04,25.04,25.6,25.6,25.04,25.6,25.04,25.6,23.92,25.04,21.3,21.8,22.3,21.8,20.8,16.1,20.3,18.3,13.22,19.3,19.3,18.3,14.4,13.86,13.36,12.9,12.48,12.1,11.75,11.43,11.15,10.9,10.67,10.48,10.31,10.16,10.04,9.93,9.85,9.78,9.73,9.69,9.67,9.65,9.65,12.08,8.67,11.7,11.38,10.65,9.84,9.32,9.07,8.85,8.66,8.49,8.35,8.22,8.1,7.98,7.86,7.74,7.61,7.47,7.31,7.14,6.96,6.78,6.58,6.39,6.19,5.99,5.78,5.58,5.39,5.2,5.01,4.83,4.67,4.51,4.37,4.24,4.12,4.02,3.95,3.89,3.85,3.84,4.41,5.77,7.39,8.75,9.32,9.18,9,8.94,8.88,8.83,8.78,8.73,8.68,8.64,8.6,8.56,8.53,8.5,8.47,8.45,8.42,8.4,8.39,8.37,8.36,8.35,8.35,8.34,8.34,8.67,9.65,9.62,9.53,9.4,9.21,8.98,8.7,8.4,8.06,7.69,7.3,6.89,6.47,6.03,5.59,5.14,4.7,4.26,3.83,3.42,3.02,2.65,2.3,1.98,1.7,1.45,1.25,1.09,0.99,0.94,0.92,0.91,0.89,0.87,0.85,0.84,0.82,0.81,0.79,0.78,0.77,0.75,0.74,0.73,0.72,0.71,0.7,0.69,0.68,0.67,0.66,0.65,0.64,0.64,0.63,0.63,0.62,0.62,0.61,0.61,0.61,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.61,0.61,0.61,0.61,0.61,0.61,0.62,0.62,0.62,0.62,0.63,0.63,0.63,0.63,0.63,0.64,0.64,0.64,0.64,0.64,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.64,0.63,0.62,0.6,0.59,0.57,0.55,0.54,0.53,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.51,0.51,0.51,0.5,0.5,0.49,0.48,0.47,0.47,0.46,0.45,0.45,0.44,0.43,0.42,0.42,0.41,0.41,0.41,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.41,0.42,0.43,0.44,0.46,0.48,0.5,0.53,0.55,0.58,0.61,0.64,0.67,0.7,0.73,0.77,0.8,0.83,0.87,0.9,0.93,0.96,0.99,1.02,1.05,1.08,1.1,1.12,1.14,1.16,1.17,1.18,1.19,1.2,1.2,1.2,1.19,1.17,1.15,1.12,1.09,1.06,1.02,0.98,0.94,0.9,0.86,0.82,0.78,0.74,0.7,0.66,0.63,0.6,0.57,0.55,0.53,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.52,0.51,0.51,0.5,0.5,0.49,0.49,0.48,0.47,0.47,0.47,0.46,0.46,0.45,0.45,0.45,0.44,0.44,0.44,0.43,0.43,0.43,0.42,0.42,0.42,0.41,0.41,0.41,0.41,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.41,0.41,0.41,0.41,0.41,0.41,0.41,0.41,0.41,0.41,0.41,0.41,0.41,0.41,0.41,0.42,0.42,0.42,0.42,0.42,0.42,0.42,0.42,0.42,0.43,0.43,0.43,0.43,0.43,0.43,0.44,0.44,0.44,0.44,0.44,0.44,0.45,0.45,0.45
                        ]
                    },
                    {
                        name:'降雨量',
                        type:'line',
                        xAxisIndex: 1,
                        yAxisIndex: 1,
                        symbolSize: 8,
                        hoverAnimation: false,
                        data: [
                            0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.005,0.017,0.017,0.017,0.017,0.011,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.021,0.026,0.03,0.036,0.036,0.195,0.221,0.019,0.013,0.017,0.03,0.03,0.03,0.046,0.045,0.038,0.084,0.045,0.045,0.037,0.034,0.035,0.036,0.044,0.052,0.048,0.109,0.033,0.029,0.04,0.042,0.042,0.042,0.073,0.076,0.062,0.066,0.066,0.075,0.096,0.128,0.121,0.128,0.14,0.226,0.143,0.097,0.018,0,0,0,0,0,0.018,0.047,0.054,0.054,0.054,0.036,0.185,0.009,0.038,0.061,0.077,0.091,0.126,0.69,0.182,0.349,0.231,0.146,0.128,0.167,0.1,0.075,0.071,0.071,0.117,0.01,0.002,0.002,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.005,0.026,0.038,0.038,0.038,0.076,0.086,0.109,0.213,0.276,0.288,0.297,0.642,1.799,1.236,2.138,0.921,0.497,0.685,0.828,0.41,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.018,0.024,0.024,0.024,0.024,0.006,0.003,0.046,0.046,0.046,0.046,0.043,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.204,0.303,1.028,1.328,1.524,1.41,1.362,1.292,1.191,0.529,0.501,0.944,1.81,2.899,0.859,0.126,0.087,0.047,0,0,0,0,0.011,0.028,0.028,0.028,0.028,0.017,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.099,0.159,0.297,0.309,0.309,0.614,0.818,1.436,1.195,0.553,0.542,0.955,0.898,0.466,0.386,0.556,0.388,0.221,0.192,0.192,0.187,0.166,0.18,0.302,0.158,0.009,0.009,0.009,0.009,0.009,0.007,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.004,0.032,0.032,0.032,0.032,0.082,0.149,0.204,0.247,0.262,0.49,0.51,0.533,0.746,0.847,2.393,1.188,1.114,0.475,0.043,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.017,0.017,0.021,0.042,0.079,0.111,0.126,0.122,0.133,0.846,0.102,0.077,0.067,0.056,0.005,0,0,0,0,0,0,0,0,0,0,0,0,0,0.011,0.017,0.017,0.017,0.017,0.006,0,0,0,0,0,0.01,0.03,0.054,0.067,0.07,0.25,0.251,0.494,0.065,0.054,0.054,0.064,0.084,0.077,0.101,0.132,0.248,0.069,0.117,0.115,0.087,0.326,0.036,0.009,0.009,0.009,0.009,0.009,0.004,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.02,0.039,0.04,0.04,0.04,0.229,0.079,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.023,0.069,0.082,0.082,0.082,0.503,0.774,0.038,0.012,0.012,0.012,0.016,0.02,0.028,0.051,0.06,0.064,0.19,0.15,0.164,0.139,0.13,0.085,0.031,0.023,0.022,0.007,0.005,0.005,0.001,0,0.02,0.048,0.048,0.053,0.056,0.036,0.008,0.008,0.004,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.013,0.017,0.036,0.068,0.095,0.233,0.272,0.377,0.722,1.494,3.756,0.954,0.439,0.442,0.462,0.373,0.249,0.214,0.1,0.044,0.037,0.023,0.002,0,0,0,0,0,0,0.02,0.024,0.024,0.024,0.024,0.004,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.008,0.017,0.017,0.045,0.186,0.308,0.241,0.241,0.893,4.067,4.494,5.015,3.494,2.057,1.411,0.718,0.407,0.313,0.339,1.537,1.105,0.218,0.136,0.03,0.005,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.037,0.448,1.2,1.309,1.309,1.425,1.223,0.471,0.767,0.423,0.273,0.412,0.646,0.481,0.239,0.131,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.044,0.15,0.223,0.388,0.513,0.883,2.828,4.786,5.959,4.95,6.434,6.319,3.35,2.806,4.204,1.395,1.015,1.015,0.836,0.74,0.72,0.615,0.477,0.192,0.046,0.007,0.007,0.007,0.007,0.007,0.007,0.007,0.008,0.005,0.005,0.005,0.005,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.001,0.012,0.012,0.012,0.012,0.011,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.002,0.012,0.028,0.028,0.028,0.138,0.092,0.082,0.082,0.096,0.719,0.155,0.042,0.047,0.129,0.021,0.021,0.014,0.009,0.029,0.067,0.088,0.095,0.095,0.138,0.091,0.032,0.025,0.025,0.003,0,0,0,0,0,0,0,0,0,0,0,0,0.002,0.045,0.228,0.297,0.325,0.339,0.581,1.244,0.796,0.517,0.227,0.053,0.006,0,0,0,0,0,0,0,0,0,0.003,0.005,0.005,0.005,0.005,0.081,0.129,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.014,0.041,0.041,0.041,0.041,0.027,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.009,0.017,0.017,0.017,0.017,0.355,0.174,0.009,0.009,0.012,0.136,0.208,0.208,0.208,0.215,7.359,1.858,0.458,0.053,0.053,0.047,0.045,0.045,0.059,0.136,0.188,0.206,0.21,0.588,1.517,6.02,4.688,4.42,0.624,0.326,0.359,0.553,0.899,0.94,2.95,9.415,5.752,1.092,0.096,0.035,0.026,0.018,0.015,0.011,0.011,0.011,0,0,0,0,0,0,0,0,0,0,0,0.056,0.27,0.314,0.351,0.354,0.609,0.796,1.857,0.848,0.538,0.214,0.178,0.178,0.201,0.231,0.227,0.272,0.397,0.45,1.014,2.917,1.675,0.081,0.059,0.059,0.148,0.075,0.075,0.078,0.236,0.784,0.784,0.784,0.784,0.741,0.115,0.058,0.058,0.058,0.029,0.015,0.015,0.015,0.015,0.012,0.008,0.604,0.985,1.305,2.273,2.528,2.336,2.496,2.281,1.397,1.713,3.259,1.167,0.745,0.548,1.058,0.684,0.728,0.392,0.179,0.283,0.283,0.46,0.08,0.099,0.099,0.099,0.1,0.143,0.137,0.238,0.317,0.262,0.225,0.792,0.426,0.332,0.261,0.11,0.093,0.102,0.171,0.292,0.504,0.605,1.745,2.485,1.964,0.33,0.171,0.259,0.242,0.215,0.366,0.354,0.205,0.203,0.262,0.153,0.13,0.137,0.362,0.691,0.295,0.433,0.154,0.056,0.053,0.053,0.053,0.051,0.047,0.065,0.078,0.091,0.206,0.813,0.102,0.151,0.05,0.024,0.004,0.001,0,0,0,0.021,0.021,0.021,0.021,0.021,0.013,0.013,0.013,0.013,0.013,0.013,0.013,0.013,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.008,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.018,0.021,0.021,0.021,0.021,0.003,0,0,0,0,0,0,0,0,0,0.024,0.173,0.261,0.267,0.267,0.534,1.354,1.772,0.72,0.218,0.018,0.018,0.028,0.036,0.032,0.194,0.082,0.035,0.286,0.027,0.038,0.038,0.027,0.021,0.014,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.016,0.017,0.017,0.031,0.047,0.043,0.056,0.104,0.149,0.179,0.205,0.328,0.998,0.522,1.851,3.727,3.273,2.204,1.169,1.006,1.179,0.74,0.741,1.065,0.925,0.671,0.497,0.431,0.327,0.277,0.126,0.581,0.207,0.359,2.485,0.038,0.036,0.003,0.003,0.003,0.003,0.004,0.098,0.023,0.021,0.021,0.022,0.041,0.041,0.043,0.045,0.043,0.014,0.014,0.014,0.014,0.014,0.014,0.014,0.031,0.046,0.063,0.119,0.107,0.092,0.085,0.065,0.06,0.054,0.042,0.039,0.046,0.044,0.028,0.028,0.02,0.013,0.013,0.013,0.013,0.016,0.032,0.031,0.031,0.031,0.028,0.011,0.011,0.011,0.011,0.011,0.023,0.024,0.024,0.024,0.019,0.015,0.015,0.015,0.015,0.015,0.015,0.013,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.001,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.011,0.017,0.024,0.026,0.061,0.172,0.206,0.213,0.267,0.511,0.668,0.157,0.017,0.017,0.017,0.046,0.054,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.001,0.017,0.017,0.017,0.017,0.016,0,0,0,0,0,0,0,0,0,0.01,0.017,0.017,0.017,0.017,0.012,0.017,0.017,0.017,0.017,0.012,0,0,0,0,0,0.003,0.031,0.066,0.093,0.112,0.122,0.202,0.068,0.041,0.022,0.011,0,0,0,0,0,0,0,0,0,0,0,0.002,0.005,0.012,0.021,0.021,0.019,0.033,0.03,0.026,0.026,0.034,0.095,0.024,0.024,0.024,0.023,0.019,0.018,0.018,0.018,0.011,0.03,0.045,0.044,0.044,0.044,0.022,0.009,0.024,0.033,0.033,0.033,0.024,0.009,0,0,0,0,0,0,0.003,0.017,0.017,0.017,0.017,0.014,0,0,0,0,0,0.032,0.032,0.032,0.032,0.032,0.005,0.008,0.009,0.014,0.014,0.009,0.005,0.004,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.007,0.009,0.009,0.009,0.009,0.043,0.063,0.084,0.098,0.101,0.213,0.334,0.383,0.43,0.448,0.511,0.801,0.835,1.642,1.614,1.496,1.496,1.476,1.068,0.481,0.22,0.119,0.099,0.07,0.072,0.063,0.076,0.14,0.205,0.28,0.297,0.3,0.479,0.877,1.098,1.611,1.629,1.686,1.686,1.631,1.528,1.862,1.703,1.531,2.196,0.395,0.416,0.453,0.728,0.917,0.986,1.17,2.171,3.011,2.909,3.301,1.377,0.778,0.799,0.947,1.039,0.879,0.76,1.372,1.674,1.674,1.68,1.823,1.793,1.162,0.783,0.216,0.152,0.152,0.152,0.049,0,0,0,0.117,0.127,0.127,0.127,0.127,0.127,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.003,0.005,0.005,0.005,0.005,0.003,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.309,0.364,0.364,0.364,0.364,0.063,0.01,0.01,0.01,0.012,0.015,0.015,0.11,0.55,0.824,0.825,0.829,1.39,1.429,1.342,1.43,1.636,1.717,2.135,2.203,3.191,3.022,1.589,0.86,0.807,0.645,0.595,0.588,0.557,0.552,1.271,0.708,0.677,0.629,0.714,0.203,0.133,0.061,0.062,0.018,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.001,0.072,0.29,0.438,0.53,0.557,0.873,1.039,1.04,0.208,0.049,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.03,0.039,0.039,0.039,0.039,0.098,0.008,0.007,0.007,0.007,0.007,0.007,0.007,0.007,0.007,0.007,0.056,0.062,0.065,0.065,0.065,0.047,0.216,0.256,0.315,0.4,0.502,0.449,0.47,0.571,0.814,1.153,0.774,0.202,0.086,0.075,0.071,0.032,0.019,0.003,0.004,0.004,0.004,0.004,0.004,0.004,0.007,0.072,0.153,0.256,0.306,0.404,0.698,0.733,0.823,0.715,0.563,0.404,0.293,0.217,0.213,0.202,0.202,0.294,0.704,0.797,1.359,1.101,0.72,0.514,0.539,0.434,0.389,0.387,0.386,0.375,0.369,0.319,0.239,0.183,0.136,0.062,0.052,0.096,0.119,0.119,0.114,0.127,0.132,0.139,0.169,0.191,0.278,0.254,0.214,0.237,0.221,0.143,0.129,0.125,0.109,0.1,0.087,0.06,0.038,0.029,0.029,0.028,0.048,0.053,0.053,0.111,0.125,0.102,0.097,0.097,0.039,0.02,0.02,0.02,0.014,0.004,0.031,0.043,0.047,0.052,0.08,0.144,0.182,0.176,0.171,0.149,0.112,0.025,0,0,0,0,0,0,0,0.016,0.031,0.031,0.031,0.031,0.015,0,0,0,0,0,0.005,0.005,0.005,0.005,0.005,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.005,0.005,0.005,0.005,0.005,0.001,0,0,0
                        ]
                    }
                ]
            };
            $scope.options = options;
        }])

})(angular.module('act-charts'));

angular.module('act-admin', ['act-core']);

(function (module) {
    module.config(['$routeProvider', function($routeProvider) {
        $routeProvider
            .when('/admin/users', {
                title: 'users',
                controller: 'UserAdminCtrl',
                templateUrl: 'admin/view/admin-user.html',
                resolve: {
                    users: ['$http', 'userServiceUrl', function ($http, userServiceUrl) {
                        return $http.get(userServiceUrl);
                    }]
                }
            })
            .when('/admin/groups', {
                title: 'groups',
                controller: 'GroupAdminCtrl',
                templateUrl: 'admin/view/admin-group.html',
                resolve: {
                    groups: ['$http', 'groupServiceUrl', function ($http, groupServiceUrl) {
                        return $http.get(groupServiceUrl);
                    }]
                }
            })
    }])
})(angular.module('act-admin'));

(function (module) {
    module
        .directive('actSelections', [function () {
            return {
                templateUrl: 'admin/view/group-selection.html',
                controller: ['$scope', function ($scope) {
                    $scope.remainGroups = [];
                    for (var i = 0; i < $scope.allGroups.length; i++) {
                        var item = $scope.allGroups[i];
                        var exists = false;
                        for (var j = 0; j < $scope.userGroups.length; j++) {
                            if ($scope.userGroups[j].id === item.id) {
                                exists = true;
                                break;
                            }
                        }
                        if (!exists) {
                            $scope.remainGroups.push(item);
                        }
                    }

                    $scope.selectSourceGroup = function (group) {
                        $scope.selectedSource = group;
                        $scope.selectedTarget = null;
                    };

                    $scope.selectTargetGroup = function (group) {
                        $scope.selectedTarget = group;
                        $scope.selectedSource = null;
                    };

                    $scope.moveToTarget = function () {
                        if ($scope.selectedSource) {
                            var group = $scope.selectedSource;
                            var i = $scope.remainGroups.indexOf(group);

                            $scope.remainGroups.splice(i, 1);
                            $scope.userGroups.push(group);

                            $scope.selectedSource = null;
                        }
                    };

                    $scope.moveToSource = function (group) {
                        if ($scope.selectedTarget) {
                            var group = $scope.selectedTarget;
                            var i = $scope.userGroups.indexOf(group);

                            $scope.userGroups.splice(i, 1);
                            $scope.remainGroups.push(group);

                            $scope.selectedTarget = null;
                        }
                    };
                }]
            };
        }])
})(angular.module('act-admin'));

(function (module) {
    module.controller('UserAdminCtrl', ['users', '$scope', '$http', '$uibModal', 'groupServiceUrl',
        function (users, $scope, $http, $uibModal, groupServiceUrl) {
            $scope.gridOptions = {
                rowSelection: true,
                multiSelect: false,
                enableRowHeaderSelection: false,
                data: users.data.data,
                onRegisterApi: function (gridApi) {
                    $scope.gridApi = gridApi;
                    gridApi.selection.on.rowSelectionChanged($scope, selectUser);
                }
            };

            function selectUser(row) {
                $scope.selectedUser = row.entity;
            }

            $scope.addUser = function () {
                $uibModal.open({
                    templateUrl: 'admin/view/user-create-dialog.html',
                    animation: true,
                    resolve: {
                        allGroups: ['groupServiceUrl', '$http', function (groupServiceUrl, $http) {
                            return $http.get(groupServiceUrl);
                        }]
                    },
                    controller: 'UserAddModalCtrl',
                })
                    .result.then(function (newUser) {
                    if (newUser) {
                        $scope.gridOptions.data.push(newUser);
                    }
                });
            };

            $scope.changeUser = function (user) {
                $uibModal.open({
                    templateUrl: 'admin/view/user-change-dialog.html',
                    animation: true,
                    resolve: {
                        user: user,
                        userGroups: ['groupServiceUrl', '$http', function (groupServiceUrl, $http) {
                            return $http.get(groupServiceUrl + '?member=' + user.id);
                        }],
                        allGroups: ['groupServiceUrl', '$http', function (groupServiceUrl, $http) {
                            return $http.get(groupServiceUrl);
                        }]
                    },
                    controller: 'UserChangeModalCtrl'
                });
            }
        }])
        .controller('UserAddModalCtrl', ['allGroups', '$scope', '$http', '$uibModalInstance', 'userServiceUrl', 'groupServiceUrl',
            function (allGroups, $scope, $http, $uibModalInstance, userServiceUrl, groupServiceUrl) {
                $scope.newUser = {};
                $scope.userGroups = [];
                $scope.allGroups = allGroups.data.data;

                $scope.ok = function (user) {
                    $http
                        .post(userServiceUrl, $scope.newUser)
                        .then(function () {
                                for (var i = 0; i < $scope.userGroups.length; i++) {
                                    var item = $scope.userGroups[i];
                                    $http.post(groupServiceUrl + '/' + item.id + '/members', {userId: user.id});
                                }

                                $uibModalInstance.close(user);
                            },
                            function () {
                                $log.error('Failed to create User');
                            });


                };
                $scope.cancel = function () {
                    $uibModalInstance.close();
                }
            }])
        .controller('UserChangeModalCtrl', ['user', 'userGroups', 'allGroups', '$http', '$scope', '$uibModalInstance', 'userServiceUrl', 'groupServiceUrl',
            function (user, userGroups, allGroups, $http, $scope, $uibModalInstance, userServiceUrl, groupServiceUrl) {
                $scope.user = user;
                var originalGroups = userGroups.data.data;

                $scope.userGroups = angular.copy(originalGroups);
                $scope.allGroups = allGroups.data.data;

                $scope.ok = function (user, userGroups) {
                    $http
                        .put(userServiceUrl + '/' + user.id, {
                            firstName: user.firstName,
                            lastName: user.lastName,
                            email: user.email
                        })
                        .then(function () {
                                $uibModalInstance.close(user);
                            },
                            function () {
                                $log.error('Failed to create User');
                            });

                    for (var i = 0; i < $scope.allGroups.length; i++) {
                        var item = $scope.allGroups[i];

                        var a = false, b = false;
                        for (var j = 0; j < originalGroups.length; j++) {
                            if (originalGroups[j].id === item.id) {
                                a = true;
                                break;
                            }
                        }
                        for (var k = 0; k < userGroups.length; k++) {
                            if (userGroups[k].id === item.id) {
                                b = true;
                                break;
                            }
                        }

                        if (a ^ b) {
                            var id = item.id;
                            if (a) { // remove
                                $http.delete(groupServiceUrl + '/' + id + '/members/' + user.id);
                            } else if (b) { // add
                                $http.post(groupServiceUrl + '/' + id + '/members', {userId: user.id});
                            }
                        }
                    }
                };
                $scope.cancel = function () {
                    $uibModalInstance.close();
                }
            }]);
})(angular.module('act-admin'));

(function (module) {
    module
        .controller('GroupAdminCtrl', ['groups', '$scope', '$uibModal', '$log',
            function (groups, $scope, $uibModal, $log) {
                $scope.gridOptions = {
                    rowSelection: true,
                    multiSelect: false,
                    enableRowHeaderSelection: false,
                    data: groups.data.data,
                    onRegisterApi: function (gridApi) {
                        $scope.gridApi = gridApi;
                        gridApi.selection.on.rowSelectionChanged($scope, selectGroup);
                    }
                };

                function selectGroup(group) {
                    $scope.selectedGroup = group.entity;
                }

                $scope.addGroup = function () {
                    $uibModal.open({
                        templateUrl: 'admin/view/group-create-dialog.html',
                        animation: true,
                        controller: 'GroupAddModalCtrl'
                    })
                        .result.then(function (newGroup) {
                        if (newGroup) {
                            $scope.gridOptions.data.push(newGroup);
                        }
                    }, function () {
                        $log.error("Failed to create Group");
                    });
                };

                $scope.changeGroup = function (group) {
                    $uibModal.open({
                        templateUrl: 'admin/view/group-change-dialog.html',
                        animation: true,
                        resolve: {
                            group: group
                        },
                        controller: 'GroupChangeModalCtrl'
                    });
                };
            }])
        .controller('GroupAddModalCtrl', ['$scope', '$uibModalInstance', 'groupServiceUrl', '$http',
            function ($scope, $uibModalInstance, groupServiceUrl, $http) {
                $scope.newGroup = {};
                $scope.ok = function () {
                    $http.post(groupServiceUrl, $scope.newGroup)
                        .then(function () {
                                $uibModalInstance.close($scope.newGroup);
                            },
                            function () {
                                $log.error('Failed to create Group');
                            });
                };
                $scope.cancel = function () {
                    $uibModalInstance.close();
                };
            }])
        .controller('GroupChangeModalCtrl', ['group', 'groupServiceUrl', '$scope', '$http', '$uibModalInstance',
            function (group, groupServiceUrl, $scope, $http, $uibModalInstance) {
                $scope.group = group;
                $scope.ok = function (group) {
                    $http
                        .put(groupServiceUrl + '/' + group.id, {
                            name: group.name
                        })
                        .then(
                            function () {
                                $uibModalInstance.close(group);
                            },
                            function () {
                                $log.error('Failed to update Group');
                            }
                        );
                };
                $scope.cancel = function () {
                    $uibModalInstance.close();
                }
            }]);
})(angular.module('act-admin'));

(function(module) {
    module
        .factory('userServiceUrl', ['serviceUrl', function(serviceUrl) {
            return serviceUrl + '/identity/users';
        }])
        .factory('groupServiceUrl', ['serviceUrl', function(serviceUrl) {
            return serviceUrl + '/identity/groups';
        }]);
})(angular.module('act-admin'));

angular.module('agLocale')
    .config(['$translateProvider', function($translateProvider) {
        $translateProvider.useLoader('localeLoader');
        $translateProvider.useStorage('translateStorage');
        $translateProvider.useSanitizeValueStrategy('sanitizeParameters');

    }])
    //Locales config
    .constant('localeKeys', {keys: ['en', 'zh'], aliases:{'en_*': 'en','zh_*': 'zh'},
        langDisplay:{'en': 'English', 'zh': '中文'}})

    .config(['$translateProvider', 'localeKeys', function($translateProvider, localeKeys) {
        $translateProvider.registerAvailableLanguageKeys(localeKeys.keys, localeKeys.aliases);

        // $translateProvider.determinePreferredLanguage();
        $translateProvider.preferredLanguage('zh');
        $translateProvider.fallbackLanguage('zh');

        if($translateProvider.preferredLanguage() === undefined){
            $translateProvider.preferredLanguage(localeKeys.keys[0]);
        }
    }]);

/*! 1.4.0 */
!function(){var a=angular.module("angularFileUpload",[]);a.service("$upload",["$http","$timeout",function(a,b){function c(c){c.method=c.method||"POST",c.headers=c.headers||{},c.transformRequest=c.transformRequest||function(b,c){return window.ArrayBuffer&&b instanceof window.ArrayBuffer?b:a.defaults.transformRequest[0](b,c)},window.XMLHttpRequest.__isShim&&(c.headers.__setXHR_=function(){return function(a){a&&(c.__XHR=a,c.xhrFn&&c.xhrFn(a),a.upload.addEventListener("progress",function(a){c.progress&&b(function(){c.progress&&c.progress(a)})},!1),a.upload.addEventListener("load",function(a){a.lengthComputable&&c.progress&&c.progress(a)},!1))}});var d=a(c);return d.progress=function(a){return c.progress=a,d},d.abort=function(){return c.__XHR&&b(function(){c.__XHR.abort()}),d},d.xhr=function(a){return c.xhrFn=a,d},d.then=function(a,b){return function(d,e,f){c.progress=f||c.progress;var g=b.apply(a,[d,e,f]);return g.abort=a.abort,g.progress=a.progress,g.xhr=a.xhr,g.then=a.then,g}}(d,d.then),d}this.upload=function(b){b.headers=b.headers||{},b.headers["Content-Type"]=void 0,b.transformRequest=b.transformRequest||a.defaults.transformRequest;var d=new FormData,e=b.transformRequest,f=b.data;return b.transformRequest=function(a,c){if(f)if(b.formDataAppender)for(var d in f){var g=f[d];b.formDataAppender(a,d,g)}else for(var d in f){var g=f[d];if("function"==typeof e)g=e(g,c);else for(var h=0;h<e.length;h++){var i=e[h];"function"==typeof i&&(g=i(g,c))}a.append(d,g)}if(null!=b.file){var j=b.fileFormDataName||"file";if("[object Array]"===Object.prototype.toString.call(b.file))for(var k="[object String]"===Object.prototype.toString.call(j),h=0;h<b.file.length;h++)a.append(k?j+h:j[h],b.file[h],b.file[h].name);else a.append(j,b.file,b.file.name)}return a},b.data=d,c(b)},this.http=function(a){return c(a)}}]),a.directive("ngFileSelect",["$parse","$timeout",function(a,b){return function(c,d,e){var f=a(e.ngFileSelect);d.bind("change",function(a){var d,e,g=[];if(d=a.target.files,null!=d)for(e=0;e<d.length;e++)g.push(d.item(e));b(function(){f(c,{$files:g,$event:a})})}),("ontouchstart"in window||navigator.maxTouchPoints>0||navigator.msMaxTouchPoints>0)&&d.bind("touchend",function(a){a.preventDefault(),a.target.click()})}}]),a.directive("ngFileDropAvailable",["$parse","$timeout",function(a,b){return function(c,d,e){if("draggable"in document.createElement("span")){var f=a(e.ngFileDropAvailable);b(function(){f(c)})}}}]),a.directive("ngFileDrop",["$parse","$timeout",function(a,b){return function(c,d,e){function f(a,b){if(b.isDirectory){var c=b.createReader();i++,c.readEntries(function(b){for(var c=0;c<b.length;c++)f(a,b[c]);i--})}else i++,b.file(function(b){i--,a.push(b)})}if("draggable"in document.createElement("span")){var g=null,h=a(e.ngFileDrop);d[0].addEventListener("dragover",function(a){b.cancel(g),a.stopPropagation(),a.preventDefault(),d.addClass(e.ngFileDragOverClass||"dragover")},!1),d[0].addEventListener("dragleave",function(){g=b(function(){d.removeClass(e.ngFileDragOverClass||"dragover")})},!1);var i=0;d[0].addEventListener("drop",function(a){a.stopPropagation(),a.preventDefault(),d.removeClass(e.ngFileDragOverClass||"dragover");var g=[],j=a.dataTransfer.items;if(j&&j.length>0&&j[0].webkitGetAsEntry)for(var k=0;k<j.length;k++)f(g,j[k].webkitGetAsEntry());else{var l=a.dataTransfer.files;if(null!=l)for(var k=0;k<l.length;k++)g.push(l.item(k))}!function m(d){b(function(){i?m(10):h(c,{$files:g,$event:a})},d||0)}()},!1)}}}])}();
angular.module('act-dashboard', ['act-core', 'act-charts'])
    .controller('DashboardController', [function () {

    }]);

(function () {
    'use strict';

    angular.module('act',
        ['act-dashboard', 'act-page', 'agStorage', 'act-session', 'agIdentity', 'agForm', 'act-process', 'agTask', 'act-ui', 'actDiagram', 'act-admin'])

        //Restangular config
        .config(['RestangularProvider', function (RestangularProvider) {
            RestangularProvider.setRestangularFields({
                selfLink: 'url'
            });
            RestangularProvider.addResponseInterceptor(function (data, operation, what, url, response, deferred) {
                var extractedData;
                // extract data meta data
                if (operation === "getList" && data.data) {
                    extractedData = data.data;
                    extractedData.total = data.total;
                    extractedData.start = data.start;
                    extractedData.sort = data.sort;
                    extractedData.order = data.order;
                    extractedData.size = data.size;

                } else {
                    extractedData = data;
                }
                return extractedData;
            });
        }])

        //$form config
        .config(['$formProvider', function ($formProvider) {
            function escapeRegExp(str) {
                return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
            }

            function replaceAll(find, replace, str) {
                return str.replace(new RegExp(escapeRegExp(find), 'g'), replace);
            }

            $formProvider.addFormPropertyHandler('date', {
                viewId: 'form/view/date.html',
                initFormProperty: ['formProperty', function (formProperty) {

                    if (formProperty.value !== null) {

                        if (formProperty.datePattern)
                            formProperty.value = moment(formProperty.value, replaceAll('y', 'Y', replaceAll('d', 'D', formProperty.datePattern))).toDate();

                    }
                }],
                prepareForSubmit: ['$filter', 'formProperty', function ($filter, formProperty) {
                    formProperty.value = $filter('date')(formProperty.value, formProperty.datePattern);
                }]
            });

            $formProvider.addFormPropertyHandler('long', {
                viewId: 'form/view/long.html',
                initFormProperty: ['formProperty', function (formProperty) {
                    if (formProperty.value !== null) {
                        formProperty.value = parseInt(formProperty.value);
                    }
                }]
            });

            $formProvider.addFormPropertyHandler('boolean', {
                viewId: 'form/view/boolean.html'
            });

            $formProvider.addFormPropertyHandler('enum', {
                viewId: 'form/view/enum.html'
            });

            $formProvider.addFormPropertyHandler('user', {
                viewId: 'form/view/user.html'
            });

        }])
        //$routes


        .controller('ProfileController', ['$scope', 'Session', function ($scope, Session) {
            $scope.logout = function () {
                Session.logout();
            };
        }])

        .config(['$otherwiseProvider', function ($otherwiseProvider) {
            $otherwiseProvider.setHandler('otherwiseTranslate');
        }])
        .factory('otherwiseTranslate', ['$translate', function ($translate) {
            return {
                get: function (key, params) {
                    return $translate.instant(key, params);
                }
            };
        }])
        .directive('agSelectUser', ['$parse', '$ui', function ($parse, $ui) {
            return function (scope, element, attr) {
                if (attr.ngReadonly) {
                    if (scope.$eval(attr.ngReadonly)) return;
                }
                var userModel = $parse(attr.agSelectUser);
                element.on('click', function () {
                    $ui.showSelectIdentity('user', 'SELECT_IDENTITY_user', function (identityLink) {
                        userModel.assign(scope, identityLink.user);
                    });
                });
            };
        }]);

})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('account/view/profile.html',
    '<div class="incontrols"><div class="row controls" ng-include="\'views/account/menu.html\'"></div></div><div class="row listRow"><div class="col-md-12 innerContent"><div class="alist"><div class="row subRow"><div class="col-md-2 colData"></div><div class="col-md-8 colData" ng-controller="UserProfileController"><div class="detail"><div class="edit"><button class="btn btn-primary btn-sm user-profile-edit" ng-click="changePassword()" translate="CHANGE_PASSWORD"></button></div><div class="name" translate="PROFILE">Profile</div><div class="user-profile"><div class="row subRow"><div class="col-md-4 authorImg prefs colData"><img ag-profile-pic-preview="selectedFile"></div><div class="col-md-8"><form name="editProfileForm" autocomplete="off" ng-submit="submitForm(editProfileForm.$valid)" novalidate><div class="row subRow"><div class="col-lg-12 colData"><div class="input-group"><span translate="FIRST_NAME" class="input-group-addon">First Name</span> <input ng-required="true" ng-model="userProfile.firstName" class="form-control" autocomplete="off" name="firstName"> <span class="input-group-addon invalid" ng-if="editProfileForm.firstName.$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div></div><div class="row subRow"><div class="col-lg-12 colData"><div class="input-group"><span translate="LAST_NAME" class="input-group-addon">Last Name</span> <input ng-required="true" ng-model="userProfile.lastName" class="form-control" autocomplete="off" name="lastName"> <span class="input-group-addon invalid" ng-if="editProfileForm.lastName.$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div></div><div class="row subRow"><div class="col-lg-12 colData"><div class="input-group"><span translate="EMAIL" class="input-group-addon">Email</span> <input type="email" ng-model="userProfile.email" class="form-control" autocomplete="off" name="email"> <span class="input-group-addon invalid" ng-if="editProfileForm.email.$error.email"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div></div><div class="row subRow"><div class="col-lg-12 colData"><div class="input-group"><span class="input-group-addon" translate="PICTURE"></span> <span class="btn btn-default btn-file form-control"><span ng-if="!fileName" class="glyphicon glyphicon-paperclip"></span> <span ng-if="fileName">{{fileName}}</span> <input name="selFile" type="file" ng-file-select="onPictureSelect($files);"></span> <span class="input-group-addon invalid" ng-if="invalidImg"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div></div><div class="row subRow"><div class="col-lg-12 colData" style="text-align: center"><button class="btn btn-primary" type="submit" translate="SAVE"></button> <button class="btn btn-warning" ag-click="resetForm()" translate="RESET"></button></div></div></form></div></div></div></div></div><div class="col-md-2 colData"></div></div></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('admin/view/admin-group.html',
    '<div class="col-md-12 innerContent"><div class="alist"><div class="col-lg-12"><h2 class="page-header" translate="MENU_GROUP"></h2></div><div class="col-xs-8"><div ui-grid="gridOptions" ui-grid-selection></div></div><div class="col-xs-4"><button class="btn btn-primary" ng-click="addGroup()">Add</button> <button class="btn btn-primary" ng-if="selectedGroup" ng-click="changeGroup(selectedGroup)">修改</button></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('admin/view/admin-user.html',
    '<div class="col-md-12 innerContent"><div class="alist"><div class="col-lg-12"><h2 class="page-header" translate="MENU_USER">User</h2></div><div class="col-lg-8"><div ui-grid="gridOptions" ui-grid-selection></div></div><div class="col-xs-4"><button class="btn btn-primary" ng-click="addUser()">添加</button> <button class="btn btn-primary" ng-if="selectedUser" ng-click="changeUser(selectedUser)">修改</button></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('admin/view/group-change-dialog.html',
    '<div class="modal-header"><button type="button" class="close" ng-click="cancel()">&times;</button><h4 class="modal-title">修改组信息</h4></div><div class="modal-body"><form name="groupForm" novalidate><div class="form-group" ng-class="{\'has-error\': groupForm.idd.$invalid}"><label>组ID</label><input class="form-control" name="idd" ng-model="group.id" ng-disabled="true"></div><div class="form-group" ng-class="{\'has-error\': groupForm.inputName.$invalid}"><label>组名</label><input name="inputName" class="form-control" required ng-model="group.name"></div></form></div><div class="modal-footer"><button type="button" class="btn btn-default" ng-click="cancel();">{{\'_CANCEL\' | translate}}</button> <button type="button" class="btn btn-primary" ng-click="ok(group)" ng-disabled="!groupForm.$valid">{{\'_OK\' | translate}}</button></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('admin/view/group-create-dialog.html',
    '<div class="modal-header"><button type="button" class="close" ng-click="cancel()">&times;</button><h4 class="modal-title">创建组</h4></div><div class="modal-body"><form name="groupForm" novalidate><div class="form-group" ng-class="{\'has-error\': groupForm.idd.$invalid}"><label>组ID</label><input class="form-control" name="idd" required ng-model="newGroup.id"></div><div class="form-group" ng-class="{\'has-error\': groupForm.inputName.$invalid}"><label>组名</label><input name="inputName" class="form-control" required ng-model="newGroup.name"></div></form></div><div class="modal-footer"><button type="button" class="btn btn-default" ng-click="cancel();">{{\'_CANCEL\' | translate}}</button> <button type="button" class="btn btn-primary" ng-click="ok()" ng-disabled="!groupForm.$valid">{{\'_OK\' | translate}}</button></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('admin/view/group-selection.html',
    '<div class="selection"><ul class="col-xs-4 selection-list selection-left"><li class="selection-list-item" ng-repeat="group in remainGroups track by group.id" ng-click="selectSourceGroup(group)" ng-class="{selected: group === selectedSource}">{{group.name}}</li></ul><div class="col-xs-2"><button class="btn btn-xs btn-primary btn-block" ng-class="{disabled: !selectedSource}" ng-click="moveToTarget(selectedSource)"><span class="glyphicon glyphicon-arrow-right"></span></button> <button class="btn btn-xs btn-primary btn-block" ng-class="{disabled: !selectedTarget}" ng-click="moveToSource(selectedTarget)"><span class="glyphicon glyphicon-arrow-left"></span></button></div><ul class="col-xs-4 selection-list selection-right"><li class="selection-list-item" ng-repeat="group in userGroups track by group.id" ng-click="selectTargetGroup(group)" ng-class="{selected: group === selectedTarget}">{{group.name}}</li></ul></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('admin/view/user-change-dialog.html',
    '<div class="modal-header"><h3 class="modal-title">修改用户</h3></div><form name="userForm" autocomplete="off" novalidate><div class="modal-body"><div class="form-group" ng-class="{\'has-error\': userForm.idd.$invalid}"><label>用戶ID</label><input class="form-control" name="idd" ng-disabled="true" required ng-model="user.id"></div><div class="form-group" ng-class="{\'has-error\': userForm.fName.$invalid}"><label>名字</label><input name="fName" class="form-control" required ng-model="user.firstName"></div><div class="form-group" ng-class="{\'has-error\': userForm.lName.$invalid}"><label>姓</label><input name="lName" class="form-control" required ng-model="user.lastName"></div><div class="form-group" ng-class="{\'has-error\': userForm.mail.$invalid}"><label>邮箱</label><input name="mail" type="email" class="form-control" required ng-model="user.email"></div><div class="form-group"><label>组</label><div act-selections style="height:150px"></div></div></div><div class="modal-footer"><button class="btn btn-warning" ag-click="cancel()">{{\'_CANCEL\' | translate}}</button> <button class="btn btn-primary" ng-click="ok(user, userGroups);" ng-disabled="!userForm.$valid">{{\'_OK\' | translate}}</button></div></form>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('admin/view/user-create-dialog.html',
    '<div class="modal-header"><h3 class="modal-title">新建用户</h3></div><form name="userForm" autocomplete="off" novalidate><div class="modal-body"><div class="form-group" ng-class="{\'has-error\': userForm.idd.$invalid}"><label>用戶ID</label><input class="form-control" name="idd" required ng-model="newUser.id"></div><div class="form-group" ng-class="{\'has-error\': userForm.fName.$invalid}"><label>名字</label><input name="fName" class="form-control" required ng-model="newUser.firstName"></div><div class="form-group" ng-class="{\'has-error\': userForm.lName.$invalid}"><label>姓</label><input name="lName" class="form-control" required ng-model="newUser.lastName"></div><div class="form-group" ng-class="{\'has-error\': userForm.mail.$invalid}"><label>邮箱</label><input name="mail" type="email" class="form-control" required ng-model="newUser.email"></div><div class="form-group" ng-class="{\'has-error\': userForm.pass.$invalid}"><label>密码</label><input name="pass" type="password" class="form-control" required ng-model="newUser.password"></div><div class="form-group"><label>组</label><div act-selections style="height:150px"></div></div></div><div class="modal-footer"><button class="btn btn-warning" ag-click="cancel()">{{\'_CANCEL\' | translate}}</button> <button class="btn btn-primary" ng-click="ok(newUser);" ng-disabled="!userForm.$valid">{{\'_OK\' | translate}}</button></div></form>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('archivedProcess/view/item.html',
    '<div class="pageItem"><div class="detail"><div class="row header-row"><div class="col-md-12 edit-col"><span class="label label-default"><span class="glyphicon glyphicon-time"></span> <span ag-ago="page.processInstance.startTime" translatekey="STARTED_AGO"></span></span> <span class="label label-default" ng-class="{\'label-success\': page.processInstance.deleteReason === null,\'label-warning\': page.processInstance.deleteReason === \'ACTIVITI_DELETED\'}"><span class="glyphicon glyphicon-time"></span> {{\'DELETE_REASON_\'+page.processInstance.deleteReason | translate}} <span ag-ago="page.processInstance.endTime"></span></span> <span class="label label-success"><span class="glyphicon glyphicon-tag"></span><span>{{page.processInstance.definition.category}}</span></span> <span class="label label-info"><span class="fa fa-files-o"></span><span>{{page.processInstance.definition.version}}</span></span></div></div><div class="row desc"><div class="col-md-12"><span class="glyphicon glyphicon-align-justify"></span> <span ag-content="page.processInstance.definition.description" otherwisekey="NO_DESCRIPTION"></span></div></div><div class="diagram" ag-definition-diagram="page.processInstance.definition" otherwisekey="NO_DIAGRAM"></div></div><div class="detail"><div class="row"><div class="col-md-12" ng-init="page.processInstance.refreshIdentityLinks()"><div class="name">{{\'PEOPLE\' | translate}}</div><div class="varsCon"><div class="identity-link-con"><div class="identity-link authorImg" ng-repeat="identityLink in page.processInstance.identityLinks"><img alt="profile" ag-identity-link-pic="identityLink"> <span ag-identity-link-name="identityLink"></span><div class="identity-info"><span class="label label-info"><span ag-identity-link-type="identityLink.type"></span></span></div></div></div></div><div class="emptyList" ng-if="page.processInstance.identityLinks.length === 0"><span class="label label-default" translate="NO_INVOLVEMENT"></span></div></div></div></div><div class="detail"><div class="row"><div class="col-md-12" ng-init="page.processInstance.refreshVariables()"><div class="name">{{\'VARIABLES\' | translate}}</div><div class="varsCon rowsCon scollable-rows"><div class="row line-row simple-row" ng-repeat="variable in page.processInstance.variables"><div class="col-md-5">{{variable.name}}</div><div class="col-md-6">{{variable.value | variable:variable.type}}</div><div class="col-md-1 edit-col"></div></div></div><div class="emptyList" ng-if="page.processInstance.variables.length === 0"><span class="label label-default" translate="NO_VARIABLES"></span></div></div></div></div><div class="detail"><div class="row"><div class="col-md-12" ng-init="page.processInstance.refreshTasks()"><div class="name">{{\'MENU_TASKS\' | translate}}</div><div class="varsCon rowsCon scollable-rows"><div class="row line-row img-row" ng-repeat="task in page.processInstance.tasks"><div class="col-md-3">{{task.id}} {{task.name}}</div><div class="col-md-3"><span class="glyphicon glyphicon-time"></span> <span ag-ago="task.startTime"></span></div><div class="col-md-3 authorImg"><img alt="profile" ag-user-pic="task.assignee"> <span ag-user="task.assignee" otherwisekey="NO_ASSIGNEE"></span></div><div class="col-md-3"><span class="glyphicon glyphicon-time"></span> <span ag-ago="task.endTime" otherwisekey="Not Completed"></span></div></div></div><div class="emptyList" ng-if="page.processInstance.tasks.total === 0"><span class="label label-default" translate="NO_TASKS"></span></div></div></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('archivedProcess/view/itemControls.html',
    '<div class="col-md-2"><button class="btn btn-default" uib-="{{\'_BACK\' | translate}}" ng-click="page.back()"><i class="glyphicon glyphicon-chevron-left"></i></button></div><div class="col-md-8 hname"><div>{{page.processInstance.id}} - <span ng-if="page.processInstance.name">{{page.processInstance.name}}</span><span ng-if="!page.processInstance.name">{{page.processInstance.definition.name}}</span></div></div><div class="col-md-2 itemCount"></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('archivedProcess/view/list.html',
    '<div ng-if="page.list.total === 0" class="noList"><h3><span class="label label-default" translate="NO_PROCESSES"></span></h3></div><div ng-repeat="process in page.list" class="detail"><div class="row name header-row"><div class="col-md-6 name-col"><a href="#/processes/{{page.section}}/{{process.id}}">{{process.id}} - {{process.definition.name}}</a> <a href="#/processes/{{page.section}}/{{process.id}}" class="btn btn-primary btn-xs">详情 <span class="glyphicon glyphicon-zoom-in"></span></a></div><div class="col-md-6 edit-col"><span class="label label-default"><span class="glyphicon glyphicon-time"></span> <span ag-ago="process.startTime" translatekey="STARTED_AGO"></span></span> <span class="label label-default" ng-class="{\'label-success\': process.deleteReason === null,\'label-warning\': process.deleteReason === \'ACTIVITI_DELETED\'}"><span class="glyphicon glyphicon-time"></span> {{\'DELETE_REASON_\'+process.deleteReason | translate}} <span ag-ago="process.endTime"></span></span> <span ng-if="process.definition.category" class="label label-success"><span class="glyphicon glyphicon-tag"></span> <span>{{process.definition.category}}</span></span> <span class="label label-info"><span class="fa fa-files-o"></span><span>{{process.definition.version}}</span></span></div></div><div class="row desc"><div class="col-md-12"><span class="glyphicon glyphicon-align-justify"></span> <span ag-content="process.definition.description" otherwisekey="NO_DESCRIPTION"></span></div></div><div class="diagram" ag-definition-diagram="process.definition" otherwisekey="NO_DIAGRAM"></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('archivedProcess/view/listControls.html',
    '<div class="col-md-9"><button class="btn btn-default" uib-tooltip="{{\'_REFRESH\' | translate}}" ng-click="page.refresh()"><i class="glyphicon glyphicon-refresh"></i></button><div class="btn-group abtn-group" uib-dropdown ng-init="sortBy={isopen:false}" is-open="sortBy.isopen"><button type="button" class="btn btn-default sort-btn" ng-disabled="disabled" ag-click="sortBy.isopen=!sortBy.isopen;"><span class="glyphicon glyphicon-sort"></span> {{\'SORT_BY_\'+page.sortKey | translate}}</button> <button type="button" class="btn btn-default" ag-click="page.toggleOrder()"><span class="glyphicon" ng-class="{\'glyphicon-sort-by-attributes\': page.requestParam.order === \'asc\' ,\'glyphicon-sort-by-attributes-alt\': page.requestParam.order === \'desc\'}"></span></button><ul class="dropdown-menu" role="menu"><li ng-repeat="(key, value) in page.sortKeys" ng-if="value !== page.sortKey"><a href ng-click="sortBy.isopen=false;page.sortBy(key)" translate="{{\'SORT_BY_\'+value}}"></a></li></ul></div></div><div class="col-md-3 itemCount" ng-include="\'common/view/itemsNav.html\'"></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('chart/view/bar-chart.html',
    '<div e-charts data-width="100%" data-height="500px" style="margin:30px"></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('chart/view/line-chart.html',
    '<div e-charts data-width="100%" data-height="500px" style="margin:30px"></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('chart/view/pie-chart.html',
    '<div e-charts data-width="100%" data-height="500px" style="margin:30px"></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('common/view/addAttachment.html',
    '<div class="modal-header"><h3 class="modal-title">{{title | translate}}</h3></div><form name="formPropertiesForm" autocomplete="off" ng-submit="submitForm(attachmentType, formPropertiesForm.$valid)" novalidate><div class="modal-body"><div class="row formProp"><div class="col-lg-12"><div class="input-group full-width"><div class="btn-group"><label class="btn btn-info" ng-model="attachmentType" uib-btn-radio="\'URL\'" ng-click="data.name = \'\'; selectedFile = null;">{{\'URL\' | translate}}</label><label class="btn btn-info" ng-model="attachmentType" uib-btn-radio="\'File\'" ng-click="data.name = \'\'; selectedFile = null;">{{\'FILE\' | translate}}</label></div></div></div></div><div class="row formProp"><div class="col-lg-12"><div ng-if="attachmentType === \'URL\'" class="input-group"><span class="input-group-addon" translate="URL"></span> <input name="url" type="url" class="form-control" ng-model="data.externalUrl" ng-required="true"> <span class="input-group-addon invalid" ng-if="showErrors && (formPropertiesForm.url.$error.required || formPropertiesForm.url.$error.url)"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div><div ng-if="attachmentType === \'File\'" class="input-group"><span class="input-group-addon" translate="CHOOSE_FILE"></span> <span class="btn btn-default btn-file form-control"><span ng-if="!fileName" class="glyphicon glyphicon-paperclip"></span> <span ng-if="fileName">{{fileName}}</span> <input name="selFile" type="file" ng-file-select="onFileSelect($files);fileSelected=true;fileName=$files[0].name" ng-required="true"></span> <span class="input-group-addon invalid" ng-if="showErrors && !fileSelected"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div></div><div class="row formProp"><div class="col-lg-12"><div class="input-group"><span class="input-group-addon" translate="_NAME"></span> <input name="name" class="form-control" ng-model="data.name" ng-required="true"> <span class="input-group-addon invalid" ng-if="showErrors && formPropertiesForm.name.$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div></div><div class="row formProp"><div class="col-lg-12"><div class="input-group"><span class="input-group-addon" translate="_DESCRIPTION"></span><textarea id="description" class="form-control" ng-model="data.description"></textarea></div></div></div><div class="row formProp" ng-if="uploading"><div class="col-lg-12"><progressbar class="progress-striped active" value="uploadProgress" type="{{type}}">{{type}} <i ng-if="showWarning">!!! Watch out !!!</i></progressbar></div></div></div><div class="modal-footer"><button class="btn btn-primary" type="submit" translate="_OK"></button> <button class="btn btn-warning" ag-click="cancel()" translate="_CANCEL"></button></div></form>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('common/view/addIdentityLink.html',
    '<div class="modal-header"><h3 class="modal-title" translate="{{title}}"></h3></div><form name="identityLinkForm" autocomplete="off" novalidate ng-submit="ok(identityLinkForm.$valid, selectedItems, identityRole)"><div class="modal-body"><div class="row formProp" ng-init="filteredList = (itemList | orderBy:\'+name\')" ag-keynav="filteredList"><div class="col-lg-12 select-list-con"><div class="row"><div class="col-lg-12"><div class="input-group"><input ng-model="identityFilter" tabindex="1" ag-focus ng-change="filteredList = (itemList | filter:{name: identityFilter} | orderBy:\'+name\')" class="form-control"> <span class="input-group-addon" ng-class="{\'invalid\':(showErrors && selectedItems.length===0)}"><span class="glyphicon glyphicon-search"></span></span></div></div></div><div class="row"><div class="col-lg-12"><ul id="selectionCon" tabindex="2" class="nav nav-pills nav-stacked form-control select-list"><li ng-repeat="identity in filteredList" selection-model selection-model-selected-class="active" selection-model-cleanup-strategy="deselect" selection-model-selected-items="selectedItems"><div class="item"><span ng-class="{\'glyphicon ico-space glyphicon-user\': identity.identityType === \'user\',\n' +
    '          \'fa fa-group\': identity.identityType === \'group\'}"></span> {{identity.name}}</div></li></ul></div></div></div></div><div class="row formProp"><div class="col-lg-12"><div class="input-group"><span class="input-group-addon">{{\'SELECT_ROLE_TYPE\' | translate}}</span><select tabindex="3" name="identityLinkType" class="form-control" ng-model="identityRole" ng-options="\'ROLE_\'+type | translate for type in types" ng-required="true"></select><span class="input-group-addon invalid" ng-if="showErrors && identityLinkForm.identityLinkType.$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div></div></div><div class="modal-footer"><button class="btn btn-primary" tabindex="4" type="submit" translate="_OK"></button> <button class="btn btn-warning" tabindex="5" ag-click="cancel()" translate="_CANCEL"></button></div></form>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('common/view/addVar.html',
    '<div class="modal-header"><h3 class="modal-title" translate="ADD_VAR"></h3></div><form name="addVarForm" autocomplete="off" novalidate ng-init="variable = {name:\'\'}; duplicateName = false" ng-submit="ok(addVarForm.$valid && !duplicateName, variable)"><div class="modal-body"><div class="row"><div class="col-lg-12"><div class="input-group"><span class="input-group-addon" translate="_NAME"></span> <input name="name" autocomplete="off" class="form-control" ng-model="variable.name" ng-change="duplicateName = checkDuplicate(variable.name)" ng-required="true"> <span class="input-group-addon invalid" ng-if="showErrors && (addVarForm.name.$error.required || duplicateName)"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div></div></div><div class="modal-footer"><button class="btn btn-primary" type="submit" translate="_OK"></button> <button class="btn btn-warning" ag-click="cancel()" translate="_CANCEL"></button></div></form>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('common/view/confirmation.html',
    '<div class="modal-header"><h3 class="modal-title" translate="CONFIRM_TITLE"></h3></div><div class="modal-body"><div class="row formProp"><div class="col-lg-12 confirm" translate="{{msg}}" translate-values="msgParams"></div></div></div><div class="modal-footer"><button class="btn btn-primary" ng-click="ok()">{{\'_YES\' | translate}}</button> <button class="btn btn-warning" ng-click="cancel()">{{\'_NO\' | translate}}</button></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('common/view/editVar.html',
    '<div class="modal-header"><h3 class="modal-title" translate="EDIT_VAR"></h3></div><form name="addVarForm" autocomplete="off" novalidate ng-submit="ok(addVarForm.$valid, variable)"><div class="modal-body"><div class="row"><div class="col-lg-12"><div class="input-group"><span class="input-group-addon" translate="_NAME"></span><div name="name" class="form-control">{{variable.name}}</div></div></div></div><div class="row"><div class="col-lg-12"><div class="input-group"><span class="input-group-addon" translate="VAR_TYPE"></span><select name="varType" class="form-control" ng-model="variable.type" ng-required="true"><option value="string" translate="VAR_TYPE_STRING"></option><option value="long" translate="VAR_TYPE_NUMBER"></option><option value="date" translate="VAR_TYPE_DATE"></option></select><span class="input-group-addon invalid" ng-if="showErrors && addVarForm.varType.$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div></div><div class="row"><div class="col-lg-12"><div ng-if="variable.type !== \'date\'" class="input-group"><span class="input-group-addon" translate="VAR_VALUE"></span> <input ng-if="variable.type === \'string\'" name="varValue" ng-model="variable.stringValue" class="form-control"> <input ng-if="variable.type === \'long\'" name="varValue" type="number" ng-model="variable.numberValue" ng-required="true" class="form-control"> <span class="input-group-addon invalid" ng-if="showErrors && addVarForm.varValue.$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div><div ng-if="variable.type === \'date\'" class="input-group" ng-init="status.opened = false"><span class="input-group-addon" translate="VAR_VALUE"></span> <input name="varValue" class="form-control" ng-required="true" datepicker-popup="dd-MM-yyyy hh:mm" is-open="status.opened" ng-model="variable.dateValue" close-text="Close"> <span class="input-group-btn"><button ag-click="status.opened = !status.opened;" class="btn btn-default" ng-class="{\'btn-danger\':(showErrors && addVarForm.varValue.$error.required)}"><span class="glyphicon glyphicon-calendar"></span></button></span></div></div></div></div><div class="modal-footer"><button class="btn btn-primary" type="submit" translate="_OK"></button> <button class="btn btn-warning" ag-click="cancel()" translate="_CANCEL"></button> <button class="btn btn-danger opp-float" ag-click="deleteVar(variable)" translate="_DELETE"></button></div></form>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('common/view/itemsNav.html',
    '<ul><li translate="ITEMSCOUNT" translate-values="{ from: (page.from), to:(page.to), total: (page.total) }"></li><li uib-tooltip="{{\'_PREV\' | translate}}"><button class="btn btn-default" ng-click="page.previous();tt_isOpen = false" ng-disabled="!page.hasPrevious"><i class="glyphicon glyphicon-chevron-left"></i></button></li><li uib-tooltip="{{\'_NEXT\' | translate}}"><button class="btn btn-default" ng-click="page.next();tt_isOpen = false" ng-disabled="!page.hasNext"><i class="glyphicon glyphicon-chevron-right"></i></button></li></ul>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('common/view/postComment.html',
    '<div class="modal-header"><h3 class="modal-title" translate="POST_COMMENT"></h3></div><form name="commentForm" autocomplete="off" ng-submit="submitForm(commentForm.$valid, comment)" novalidate><div class="modal-body"><div class="row formProp"><div class="col-lg-12"><div class="input-group"><span class="input-group-addon" translate="COMMENT"></span><textarea name="comment" class="form-control" ng-model="comment" ng-required="true"></textarea><span class="input-group-addon invalid" ng-show="showErrors && commentForm.comment.$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div></div></div><div class="modal-footer"><button class="btn btn-primary" type="submit">{{\'_OK\' | translate}}</button> <button class="btn btn-warning" ag-click="cancel()">{{\'_CANCEL\' | translate}}</button></div></form>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('common/view/selectIdentity.html',
    '<div class="modal-header"><h3 class="modal-title" translate="{{title}}"></h3></div><form name="identityLinkForm" autocomplete="off" novalidate ng-submit="ok(selectedItems)"><div class="modal-body"><div class="row formProp" ng-init="filteredList = (itemList | orderBy:\'+name\')" ag-keynav="filteredList"><div class="col-lg-12 select-list-con"><div class="row"><div class="col-lg-12"><div class="input-group"><input ng-model="identityFilter" tabindex="1" ag-focus ng-change="filteredList = (itemList | filter:{name: identityFilter} | orderBy:\'+name\')" class="form-control"> <span class="input-group-addon" ng-class="{\'invalid\':(showErrors && selectedItems.length===0)}"><span class="glyphicon glyphicon-search"></span></span></div></div></div><div class="row"><div class="col-lg-12"><ul id="selectionCon" tabindex="2" class="nav nav-pills nav-stacked form-control select-list"><li ng-repeat="identity in filteredList" selection-model selection-model-selected-class="active" selection-model-cleanup-strategy="deselect" selection-model-selected-items="selectedItems"><div class="item"><span ng-if="identity.identityType === \'user\'" class="glyphicon ico-space glyphicon-user"></span><span ng-if="identity.identityType === \'group\'" class="fa fa-group"></span> {{identity.name}}</div></li></ul></div></div></div></div></div><div class="modal-footer"><button ng-if="removable" tabindex="5" class="btn btn-danger opp-float" ag-click="deleteVar(variable)" translate="_DELETE"></button> <button class="btn btn-primary" tabindex="3" type="submit" translate="_OK"></button> <button class="btn btn-warning" tabindex="4" ag-click="cancel()" translate="_CANCEL"></button></div></form>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('dashboard/view/dashboard.html',
    '<div class="col-md-12 innerContent"><div class="alist"><div class="col-lg-12"><h2 class="page-header" translate="MENU_HOME">Dashboard</h2></div><div class="col-lg-8"><div class="panel panel-default"><div class="panel-heading"><i class="fa fa-bar-chart-o fa-fw"></i> 折线图</div><div class="panel-body"><div e-charts ng-controller="lineChartCtrl" data-width="100%" data-height="500px"></div></div></div><div class="panel panel-default"><div class="panel-heading"><i class="fa fa-bar-chart-o fa-fw"></i> 柱状图</div><div class="panel-body"><div e-charts ng-controller="barChartCtrl" data-width="100%" data-height="500px"></div></div></div></div><div class="col-lg-4"><div class="panel panel-default"><div class="panel-heading"><i class="fa fa-bell fa-fw"></i> 通知</div><div class="panel-body"><div class="list-group"><a href="#/tasks/inbox" class="list-group-item"><i class="fa fa-tasks fa-fw"></i> 任务 <span class="pull-right text-muted small"><em>4 minutes ago</em></span></a> <a href="#/processes/definitions" class="list-group-item"><i class="glyphicon glyphicon-random"></i> 流程 <span class="pull-right text-muted small"><em>43 minutes ago</em></span></a> <a href="#/charts/line-chart" class="list-group-item"><i class="fa fa-bar-chart-o fa-fw"></i>折线图 <span class="pull-right text-muted small"><em>43 minutes ago</em></span></a></div><a href="#/processes/definitions" class="btn btn-default btn-block">查看详情</a></div></div><div class="panel panel-default"><div class="panel-heading"><i class="fa fa-bar-chart-o fa-fw"></i> 饼图</div><div class="panel-body"><div e-charts ng-controller="pieChartCtrl" data-width="100%" data-height="500px"></div></div></div></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('core/view/listPage.html',
    '<div class="incontrols"><div class="row controls" ng-include="page.controlsTemplate"></div></div><div class="row listRow"><div class="col-md-12 innerContent"><div id="list" ng-hide="page.showingItem" class="alist" ag-page-scroll="page" ng-include="page.listTemplate"></div><div class="alist" ng-if="page.showingItem" ag-item-page="page"></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('core/view/login.html',
    '<div class="login-panel panel panel-default"><div class="panel-heading"><h3 class="panel-title">请登录</h3></div><div class="panel-body"><form role="form" name="loginForm" autocomplete="off" ng-submit="submitForm(loginForm.$valid)" novalidate><fieldset><div class="form-group"><input class="form-control" placeholder="{{\'_USERID\' | translate}}" id="userId" name="userId" autofocus ng-model="credentials.userId" required></div><div class="form-group"><input class="form-control" placeholder="{{\'_PASSWORD\' | translate}}" id="userPassword" name="userPassword" type="password" ng-model="credentials.userPassword" required value=""></div><div class="checkbox"><label><input name="remember" type="checkbox" value="Remember Me" ng-model="credentials.remember">记住我的登录</label></div><button type="submit" class="btn btn-md btn-success btn-block">{{\'_LOGIN\' | translate}}</button></fieldset></form><div class="login-msg"><span ng-if="msg.msg" class="label" ng-class="{\'label-info\':msg.type === \'info\', \'label-danger\': msg.type === \'error\'}">{{msg.msg | translate}}</span></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('core/view/main.html',
    '<div ag-loading class="con-status"><div class="loading" style="display: none" translate="LOADING"></div><div class="con-error" style="display: none" translate="CON_ERROR"></div></div><div class="notifications" ag-notifications></div><nav class="header"><div class="row"><div class="col-md-2 logo"><div></div></div><div class="col-md-1"></div><div class="col-md-6 search"></div><div class="col-md-3 profile-col" ng-controller="ProfileController" ng-init="profileDropDown.isopen = false"><div class="btn-group" uib-dropdown is-open="profileDropDown.isopen"><button type="button" uib-dropdown-toggle class="btn btn-profile"><span class="authorImg"><img alt="profile" ag-user-pic-url="currentUser.pictureUrl"> {{currentUser.name}}</span> <span class="caret"></span></button><ul class="dropdown-menu" role="menu"><li><a href="#/account/profile" ng-click="profileDropDown.isopen = false;">{{\'ACCOUNT_SETTINGS\' | translate}}</a></li><li class="divider"></li><li><a href="" ag-click="profileDropDown.isopen = false;logout()">{{\'_LOGOUT\' | translate}}</a></li></ul></div></div></div></nav><div id="content" class="row"><div id="sideNav" class="col-xs-2 left-section" ag-nav="active"><div class="page"><div class="row listRow" style="padding: 0"><div class="col-md-12 innerContent"><div class="alist"><ul class="nav nav-pills nav-stacked"><li><a href="#/dashboard"><i class="fa fa-dashboard fa-home"></i><span translate="MENU_HOME"></span></a></li></ul><ul class="nav nav-pills nav-stacked"><li class="sectionHeader"><i class="glyphicon glyphicon-random"></i> <span translate="MENU_PROCESSES">Processes</span></li><li><a href="#/processes/definitions" translate="MENU_DEFINITIONS">Definitions</a></li><li><a href="#/processes/myinstances" translate="MENU_MYINSTANCES">My Instances</a></li><li><a href="#/processes/archived" translate="MENU_ARCHIVED">Archive</a></li></ul><ul class="nav nav-pills nav-stacked"><li class="sectionHeader"><i class="fa fa-tasks"></i> <span translate="MENU_TASKS">Tasks</span></li><li><a href="#/tasks/queued" translate="MENU_QUEUED">Queue</a></li><li><a href="#/tasks/inbox" translate="MENU_INBOX">Inbox</a></li><li><a href="#/tasks/archived" translate="MENU_ARCHIVED">Archive</a></li></ul><ul class="nav nav-pills nav-stacked"><li class="sectionHeader"><i class="glyphicon glyphicon-dashboard"></i> <span>图表</span></li><li><a href="#/charts/line-chart">线图</a></li><li><a href="#/charts/bar-chart">柱状图</a></li><li><a href="#/charts/pie-chart">饼图</a></li></ul><ul class="nav nav-pills nav-stacked"><li class="sectionHeader"><i class="glyphicon glyphicon-user"></i> <span>用户和组</span></li><li><a href="#/admin/users">用户</a></li><li><a href="#/admin/groups">组</a></li></ul></div></div></div></div></div><div class="col-xs-10 right-section" act-page><div class="page" ng-include="page.template"></div><ng-view class="page"></ng-view></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('core/view/notifications.html',
    '<div ng-click="closeAlert(alert.id)" uib-alert ng-repeat="alert in alerts" type="{{alert.type}}" close=""><div class="alert-content"><span class="fa alert-icon fa-2x"></span> <span translate="{{alert.translateKey}}" translate-values="{{alert.translateValues}}"></span></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('form/view/boolean.html',
    '<div class="col-lg-12"><div class="input-group"><span class="input-group-addon"><input ag-name="formProperty.id" type="checkbox" ng-model="formProperty.value" ng-readonly="!formProperty.writable" ng-required="formProperty.required"></span> <span class="form-control">{{formProperty.name}}</span> <span class="input-group-addon invalid" ng-if="showErrors && formPropertiesForm[formProperty.id].$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('form/view/date.html',
    '<div class="col-lg-12"><div class="input-group" ng-init="formProperty.opened = false"><span class="input-group-addon">{{formProperty.name}}</span> <input ag-name="formProperty.id" class="form-control" ng-readonly="!formProperty.writable" ng-required="formProperty.required" uib-datepicker-popup="{{formProperty.datePattern}}" is-open="formProperty.opened" ng-model="formProperty.value" close-text="Close"> <span class="input-group-btn"><button ag-click="formProperty.opened = !formProperty.opened;" class="btn btn-default" ng-class="{\'btn-danger\':(showErrors && formPropertiesForm[formProperty.id].$error.required)}"><span class="glyphicon glyphicon-calendar"></span></button></span></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('form/view/enum.html',
    '<div class="col-lg-12"><div class="input-group"><span class="input-group-addon">{{formProperty.name}}</span><select ag-name="formProperty.id" class="form-control" ng-model="formProperty.value" ng-options="enumValue.id as enumValue.name for enumValue in formProperty.enumValues" ng-readonly="!formProperty.writable" ng-required="formProperty.required"></select><span class="input-group-addon invalid" ng-if="showErrors && formPropertiesForm[formProperty.id].$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('form/view/form.html',
    '<div class="modal-header"><h3 class="modal-title">{{title | translate}}</h3></div><form name="formPropertiesForm" autocomplete="off" ng-submit="submitForm(formPropertiesForm.$valid)" novalidate><div class="modal-body"><div class="row formProp" ng-repeat="formProperty in formProperties" ng-include="formProperty.view"></div></div><div class="modal-footer"><button ng-if="!readOnly" class="btn btn-primary" type="submit">{{\'_OK\' | translate}}</button> <button class="btn btn-warning" ag-click="cancel()">{{\'_CANCEL\' | translate}}</button></div></form>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('form/view/long.html',
    '<div class="col-lg-12"><div class="input-group"><span class="input-group-addon">{{formProperty.name}}</span> <input ag-name="formProperty.id" type="number" ng-model="formProperty.value" ng-readonly="!formProperty.writable" ng-required="formProperty.required" class="form-control"> <span class="input-group-addon invalid" ng-if="showErrors && formPropertiesForm[formProperty.id].$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('form/view/string.html',
    '<div class="col-lg-12"><div class="input-group"><span class="input-group-addon">{{formProperty.name}}</span> <input ag-name="formProperty.id" ng-model="formProperty.value" ng-readonly="!formProperty.writable" ng-required="formProperty.required" class="form-control"> <span class="input-group-addon invalid" ng-if="showErrors && formPropertiesForm[formProperty.id].$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('form/view/user.html',
    '<div class="col-lg-12"><div class="input-group"><span class="input-group-addon">{{formProperty.name}}</span> <span class="btn btn-default form-control" ag-select-user="formProperty.value" ng-readonly="!formProperty.writable"><span class="glyphicon glyphicon-user"></span> <span ag-user="formProperty.value" otherwisekey="SELECT_IDENTITY_user"></span> <input ag-name="formProperty.id" type="hidden" ng-model="formProperty.value" ng-required="formProperty.required"></span><span class="input-group-addon invalid" ng-if="showErrors && formPropertiesForm[formProperty.id].$error.required"><span class="glyphicon glyphicon-exclamation-sign"></span></span></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('history/view/item.html',
    '<div class="task-page"><div class="row subRow rowData"><div class="col-md-7 colData"><div class="row subRow"><div class="col-md-12 detailCol"><div class="detail"><div class="edit-col"><span class="label label-default"><span class="glyphicon glyphicon-time"></span> <span ag-ago="page.task.startTime" translatekey="CREATED_AGO"></span></span> <span class="label label-default" ng-class="{\'label-success\': page.task.deleteReason === \'completed\',\'label-warning\': page.task.deleteReason === \'ACTIVITI_DELETED\',\'label-danger\': page.task.deleteReason === \'deleted\'}"><span class="glyphicon glyphicon-time"></span> {{\'DELETE_REASON_\'+page.task.deleteReason | translate}} <span ag-ago="page.task.endTime"></span></span> <span ng-if="page.task.processInstanceId" class="label label-info"><span class="glyphicon glyphicon-random"></span> {{page.task.processInstanceId}} - {{page.task.processDefinitionId | definitionName}}</span> <span ng-if="page.task.parentTaskId" class="label label-info"><span class="glyphicon glyphicon-arrow-up"></span> {{page.task.parentTaskId}}</span> <span ng-if="page.task.dueDate" class="label label-warning"><span class="glyphicon glyphicon-calendar"></span> <span ag-ago="page.task.dueDate" translatekey="DUE_AGO"></span></span> <span ng-if="page.task.category" class="label label-default"><span class="glyphicon glyphicon-tag"></span> {{page.task.category}}</span> <span class="label" ng-class="{\'label-success\': page.task.priority === 50 ,\'label-danger\': page.task.priority > 50 , \'label-warning\': page.task.priority < 50}"><span class="glyphicon glyphicon-flag"></span></span></div><div class="row desc"><div class="col-md-12"><span class="glyphicon glyphicon-align-justify"></span> <span ag-content="page.task.description" otherwisekey="NO_DESCRIPTION"></span></div></div></div></div></div><div class="row subRow"><div class="col-md-12 detailCol"><div class="tabsCon" ng-controller="TaskTabsCtrl" ng-init="page.task.refreshIdentityLinks();selectedTab=\'people\';"><uib-tabset class="tabset"><uib-tab select="selectedTab=\'people\'"><uib-tab-heading><i class="fa fa-group"></i> {{\'PEOPLE\' | translate}}</uib-tab-heading><div class="identity-link-con"><div class="identity-link authorImg"><img alt="profile" ag-user-pic="page.task.assignee"> <span ag-user="page.task.assignee" otherwisekey="NO_ASSIGNEE"></span><div class="identity-info"><span class="label label-primary"><span ag-identity-link-type="\'assignee\'"></span></span></div></div><div class="identity-link authorImg" ng-repeat="identityLink in page.task.identityLinks"><img alt="profile" ag-identity-link-pic="identityLink"> <span ag-identity-link-name="identityLink"></span><div class="identity-info"><span class="label label-info"><span ag-identity-link-type="identityLink.type"></span></span></div></div></div></uib-tab><uib-tab select="page.task.refreshAttachments(); selectedTab=\'attachments\'"><uib-tab-heading><i class="glyphicon glyphicon-paperclip"></i> {{\'ATTACHMENTS\' | translate}}</uib-tab-heading><div class="rowsCon"><div class="row line-row img-row" ng-repeat="attachment in page.task.attachments"><div class="col-md-4" style="white-space: nowrap"><a target="_blank" ag-attachment="attachment"></a></div><div class="col-md-4" ag-content="attachment.description" otherwisekey="NO_DESCRIPTION"></div><div class="col-md-3 authorImg"><img alt="profile" ag-user-pic="attachment.userId"> <span ag-user="attachment.userId"></span></div><div class="col-md-1 edit-col"></div></div><div class="emptyList" ng-if="page.task.attachments.length === 0"><span class="label label-default" translate="NO_ATTACHMENTS"></span></div></div></uib-tab><uib-tab select="page.task.refreshSubTasks();selectedTab = \'subtasks\' "><uib-tab-heading><i class="fa fa-tasks"></i> {{\'SUBTASKS\' | translate}}</uib-tab-heading><div class="rowsCon"><div class="row line-row" ng-repeat="subTask in page.task.subTasks"><div class="col-md-2">{{subTask.id}}</div><div class="col-md-6">{{subTask.name}}</div><div class="col-md-4 authorImg"><img alt="profile" ag-user-pic="subTask.assignee"> <span ag-user="subTask.assignee" otherwisekey="NO_ASSIGNEE"></span></div></div><div class="emptyList" ng-if="page.task.subTasks.length === 0"><span class="label label-default" translate="NO_SUBTASKS"></span></div></div></uib-tab></uib-tabset></div></div></div><div class="row subRow"><div class="col-md-12 detailCol"><div class="detail"><div class="name">{{\'VARIABLES\' | translate}}</div><div class="varsCon rowsCon scollable-rows"><div class="row line-row simple-row" ng-repeat="variable in page.task.variables | orderBy:\'+name\'"><div class="col-md-4">{{variable.name}}</div><div class="col-md-7">{{variable.value | variable: variable.type}}</div><div class="col-md-1 edit-col"></div></div><div class="emptyList" ng-if="page.task.variables.length === 0"><span class="label label-default" translate="NO_VARIABLES"></span></div></div></div></div></div></div><div class="col-md-5 colData" ng-init="(page.task.events.length >= 0)? \'\':page.task.refreshEvents()"><div class="detail"><div class="name">{{\'EVENTS\' | translate}}</div><div class="eventsList" ng-include="\'task/view/event.html\'"></div></div></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('history/view/itemControls.html',
    '<div class="col-md-2"><button class="btn btn-default" uib-tooltip="{{\'_BACK\' | translate}}" ng-click="page.back()"><i class="glyphicon glyphicon-chevron-left"></i></button></div><div class="col-md-8 hname"><div>{{page.task.id}} - {{page.task.name}}</div></div><div class="col-md-2 itemCount"></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('history/view/list.html',
    '<div ng-if="page.list.total === 0" class="noList"><h3><span class="label label-default" translate="NO_TASKS"></span></h3></div><div ng-repeat="task in page.list" class="detail"><div class="row name header-row"><div class="col-md-6 name-col"><a href="#/tasks/{{page.section}}/{{task.id}}">{{task.id}} - {{task.name}}</a> <a href="#/tasks/{{page.section}}/{{task.id}}" class="btn btn-primary btn-xs">详情 <span class="glyphicon glyphicon-zoom-in"></span></a></div><div class="col-md-6 edit-col"><span class="label label-default"><span class="glyphicon glyphicon-time"></span> <span ag-ago="task.startTime" translatekey="CREATED_AGO"></span></span> <span class="label label-default" ng-class="{\'label-success\': task.deleteReason === \'completed\',\'label-warning\': task.deleteReason === \'ACTIVITI_DELETED\',\'label-danger\': task.deleteReason === \'deleted\'}"><span class="glyphicon glyphicon-time"></span> {{\'DELETE_REASON_\'+task.deleteReason | translate}} <span ag-ago="task.endTime"></span></span> <span ng-if="task.processInstanceId" class="label label-info"><span class="glyphicon glyphicon-random"></span> {{task.processInstanceId}} - {{task.processDefinitionId | definitionName}}</span> <span class="label" ng-class="{\'label-success\': task.priority === 50 ,\'label-danger\': task.priority > 50 , \'label-warning\': task.priority < 50}"><span class="glyphicon glyphicon-flag"></span></span></div></div><div class="row line-row"><div class="col-md-3 authorImg"><img alt="profile" ag-user-pic="task.assignee"> <span ag-user="task.assignee" otherwisekey="NO_ASSIGNEE"></span></div><div class="col-md-3"><span class="glyphicon glyphicon-calendar"></span> <span ag-ago="task.dueDate" otherwisekey="NO_DUE" translatekey="DUE_AGO"></span></div><div ng-if="task.category" class="col-md-3"><span class="glyphicon glyphicon-tag"></span><span>{{task.category}}</span></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('history/view/listControls.html',
    '<div class="col-xs-6"><button class="btn btn-default" uib-tooltip="{{\'_REFRESH\' | translate}}" ng-click="page.refresh()"><i class="glyphicon glyphicon-refresh"></i></button><div class="btn-group abtn-group" uib-dropdown ng-init="sortBy={isopen:false}" is-open="sortBy.isopen"><button type="button" class="btn btn-default sort-btn" ng-disabled="disabled" ag-click="sortBy.isopen=!sortBy.isopen;"><span class="glyphicon glyphicon-sort"></span> {{\'SORT_BY_\'+page.sortKey | translate}}</button> <button type="button" class="btn btn-default" ag-click="page.toggleOrder()"><span class="glyphicon" ng-class="{\'glyphicon-sort-by-attributes\': page.requestParam.order === \'asc\' ,\'glyphicon-sort-by-attributes-alt\': page.requestParam.order === \'desc\'}"></span></button><ul class="dropdown-menu" role="menu"><li ng-repeat="(key, value) in page.sortKeys" ng-if="value !== page.sortKey"><a href ng-click="sortBy.isopen=false;page.sortBy(key)" translate="{{\'SORT_BY_\'+value}}"></a></li></ul></div></div><div class="col-xs-6 itemCount" ng-include="\'common/view/itemsNav.html\'"></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('process/view/item.html',
    '<div class="pageItem"><div class="detail"><div class="row header-row"><div class="col-md-12 edit-col"><span class="label label-default"><span class="glyphicon glyphicon-time"></span> <span ag-ago="page.processInstance.startTime" translatekey="STARTED_AGO"></span></span> <span class="label label-success"><span class="glyphicon glyphicon-tag"></span><span>{{page.processInstance.definition.category}}</span></span> <span class="label label-info"><span class="fa fa-files-o"></span><span>{{page.processInstance.definition.version}}</span></span></div></div><div class="row desc"><div class="col-md-12"><span class="glyphicon glyphicon-align-justify"></span> <span ag-content="page.processInstance.definition.description" otherwisekey="NO_DESCRIPTION"></span></div></div><div class="diagram" ag-process-diagram="page.processInstance" ag-process-activities="page.processInstance.activities" otherwisekey="NO_DIAGRAM"></div></div><div class="detail"><div class="row"><div class="col-md-12" ng-init="page.processInstance.refreshIdentityLinks()"><div class="edit"><button class="btn btn-primary" ng-click="page.addIdentityLink(page.processInstance)"><i class="glyphicon glyphicon-plus"></i></button></div><div class="name">{{\'PEOPLE\' | translate}}</div><div class="varsCon"><div class="identity-link-con"><div class="identity-link authorImg" ng-repeat="identityLink in page.processInstance.identityLinks"><img alt="profile" ag-identity-link-pic="identityLink"> <span ag-identity-link-name="identityLink"></span><div class="identity-info"><span class="label label-info"><span ag-identity-link-type="identityLink.type"></span></span> <button ng-click="page.deleteIdentityLink(page.processInstance, identityLink)" class="btn btn-danger label"><i class="glyphicon glyphicon-remove"></i></button></div></div></div></div><div class="emptyList" ng-if="page.processInstance.identityLinks.length === 0"><span class="label label-default" translate="NO_INVOLVEMENT"></span></div></div></div></div><div class="detail"><div class="row"><div class="col-md-12" ng-init="page.processInstance.refreshVariables()"><div class="edit"><button class="btn btn-primary" ng-click="page.showAddVar(page.processInstance)"><i class="glyphicon glyphicon-plus"></i></button></div><div class="name">{{\'VARIABLES\' | translate}}</div><div class="varsCon rowsCon scollable-rows"><div class="row line-row simple-row" ng-repeat="variable in page.processInstance.variables"><div class="col-md-5">{{variable.name}}</div><div class="col-md-6">{{variable.value | variable:variable.type}}</div><div class="col-md-1 edit-col"><button ng-click="page.showEditVar(page.processInstance, variable)" class="btn btn-warning label"><i class="glyphicon glyphicon-pencil"></i></button></div></div></div><div class="emptyList" ng-if="page.processInstance.variables.length === 0"><span class="label label-default" translate="NO_VARIABLES"></span></div></div></div></div><div class="detail"><div class="row"><div class="col-md-12" ng-init="page.processInstance.refreshTasks()"><div class="name">{{\'MENU_TASKS\' | translate}}</div><div class="varsCon rowsCon scollable-rows"><div class="row line-row img-row" ng-repeat="task in page.processInstance.tasks"><div class="col-md-3">{{task.id}} {{task.name}}</div><div class="col-md-3"><span class="glyphicon glyphicon-time"></span> <span ag-ago="task.startTime"></span></div><div class="col-md-3 authorImg"><img alt="profile" ag-user-pic="task.assignee"> <span ag-user="task.assignee" otherwisekey="NO_ASSIGNEE"></span></div><div class="col-md-3"><span class="glyphicon glyphicon-time"></span> <span ag-ago="task.endTime" otherwisekey="Not Completed"></span></div></div></div><div class="emptyList" ng-if="page.processInstance.tasks.total === 0"><span class="label label-default" translate="NO_TASKS"></span></div></div></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('process/view/itemControls.html',
    '<div class="col-md-2"><button class="btn btn-default" tooltip="{{\'_BACK\' | translate}}" ng-click="page.back()"><i class="glyphicon glyphicon-chevron-left"></i></button> <button class="btn btn-default" tooltip="{{\'_REFRESH\' | translate}}" ng-click="page.refreshProcessInstance(page.processInstance)"><i class="glyphicon glyphicon-refresh"></i></button></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('process/view/list.html',
    '<div ng-if="page.list.total === 0" class="noList"><h3><span class="label label-default" translate="NO_PROCESSES"></span></h3></div><div ng-repeat="process in page.list" class="detail"><div class="row name header-row"><div class="col-md-6 name-col"><a href="#/processes/{{page.section}}/{{process.id}}">{{process.id}} - {{process.definition.name}}</a> <a href="#/processes/{{page.section}}/{{process.id}}" class="btn btn-primary btn-xs">详情 <span class="glyphicon glyphicon-zoom-in"></span></a></div><div class="col-md-6 edit-col"><span class="label label-default"><span class="glyphicon glyphicon-time"></span> <span ag-ago="process.startTime" translatekey="STARTED_AGO"></span></span> <span ng-if="process.definition.category" class="label label-success"><span class="glyphicon glyphicon-tag"></span> <span>{{process.definition.category}}</span></span> <span class="label label-info"><span class="fa fa-files-o"></span><span>{{process.definition.version}}</span></span></div></div><div class="row desc"><div class="col-md-12"><span class="glyphicon glyphicon-align-justify"></span> <span ag-content="process.definition.description" otherwisekey="NO_DESCRIPTION"></span></div></div><div class="diagram" ag-process-diagram="process" ag-process-activities="process.activities" otherwisekey="NO_DIAGRAM"></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('process/view/listControls.html',
    '<div class="col-md-9"><button class="btn btn-default" uib-tooltip="{{\'_REFRESH\' | translate}}" ng-click="page.refresh()"><i class="glyphicon glyphicon-refresh"></i></button><div class="btn-group abtn-group" uib-dropdown ng-init="sortBy={isopen:false}" is-open="sortBy.isopen"><button type="button" class="btn btn-default sort-btn" ng-disabled="disabled" ag-click="sortBy.isopen=!sortBy.isopen;"><span class="glyphicon glyphicon-sort"></span> {{\'SORT_BY_\'+page.sortKey | translate}}</button> <button type="button" class="btn btn-default" ag-click="page.toggleOrder()"><span class="glyphicon" ng-class="{\'glyphicon-sort-by-attributes\': page.requestParam.order === \'asc\' ,\'glyphicon-sort-by-attributes-alt\': page.requestParam.order === \'desc\'}"></span></button><ul class="dropdown-menu" role="menu"><li ng-repeat="(key, value) in page.sortKeys" ng-if="value !== page.sortKey"><a href ng-click="sortBy.isopen=false;page.sortBy(key)" translate="{{\'SORT_BY_\'+value}}"></a></li></ul></div></div><div class="col-md-3 itemCount" ng-include="\'common/view/itemsNav.html\'"></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('process/view/startProcess.html',
    '<div class="modal-header"><h3 class="modal-title"><span class="glyphicon glyphicon-random"></span> {{\'START_PROCESS\' | translate}}</h3></div><form name="processDefinitionForm" autocomplete="off" novalidate ng-submit="ok(selectedItems)"><div class="modal-body"><div class="row formProp" ag-keynav="filteredList"><div class="col-lg-12 select-list-con"><div class="row"><div class="col-lg-12"><div class="input-group"><input ng-model="processDefinitionFilter" tabindex="1" ag-focus ng-change="filteredList = (itemList | filter:{name: processDefinitionFilter})" class="form-control"> <span class="input-group-addon" ng-class="{\'invalid\':(showErrors && selectedItems.length===0)}"><span class="glyphicon glyphicon-search"></span></span></div></div></div><div class="row"><div class="col-lg-12"><ul id="selectionCon" tabindex="2" class="nav nav-pills nav-stacked form-control select-list"><li ng-repeat="processDefinition in filteredList" selection-model selection-model-selected-class="active" selection-model-cleanup-strategy="deselect" selection-model-selected-items="selectedItems"><div class="item"><span class="glyphicon glyphicon-random"></span> <span style="padding-left: 5px">{{processDefinition.name}}</span></div></li></ul></div></div></div></div></div><div class="modal-footer"><button class="btn btn-primary" tabindex="3" type="submit" translate="_OK"></button> <button class="btn btn-warning" tabindex="4" ag-click="cancel()" translate="_CANCEL"></button></div></form>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('task/view/event.html',
    '<div class="identity-link-con eventsTable"><div ng-repeat="taskEvent in page.task.events" class="event-item authorImg" ng-class="{\'right-event\': currentUser.id === taskEvent.userId, \'left-event\': currentUser.id !== taskEvent.userId}"><img ng-if="currentUser.id === taskEvent.userId" ag-user-pic="taskEvent.userId"><div class="popover" ng-class="{\'right\': currentUser.id === taskEvent.userId, \'left\': currentUser.id !== taskEvent.userId}"><div class="arrow"></div><div class="popover-inner"><div class="popover-title"><div ng-if="taskEvent.userId" ag-user="taskEvent.userId"></div><div ag-ago="taskEvent.time"></div></div><div class="popover-content" translate="TASK_EVENT_{{taskEvent.action}}" translate-values="taskEvent"></div></div></div><img ng-if="currentUser.id !== taskEvent.userId" ag-user-pic="taskEvent.userId"></div></div><div class="emptyList" ng-if="page.task.events.length===0"><span class="label label-default" translate="NO_EVENTS"></span></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('task/view/item.html',
    '<div class="task-page"><div class="row subRow rowData"><div class="col-md-7 colData"><div class="row subRow"><div class="col-md-12 detailCol"><div class="detail"><div class="edit-col"><span class="label label-default"><span class="glyphicon glyphicon-time"></span> <span ag-ago="page.task.createTime" translatekey="CREATED_AGO"></span></span> <span ng-if="page.task.processInstanceId" class="label label-info"><span class="glyphicon glyphicon-random"></span> {{page.task.processInstanceId}} - {{page.task.processDefinitionId | definitionName}}</span> <span ng-if="page.task.parentTaskId" class="label label-info"><span class="glyphicon glyphicon-arrow-up"></span> {{page.task.parentTaskId}}</span> <span ng-if="page.task.dueDate" class="label label-warning"><span class="glyphicon glyphicon-calendar"></span> <span ag-ago="page.task.dueDate" translatekey="DUE_AGO"></span></span> <span ng-if="page.task.category" class="label label-default"><span class="glyphicon glyphicon-tag"></span> {{page.task.category}}</span> <span class="label" ng-class="{\'label-success\': page.task.priority === 50 ,\'label-danger\': page.task.priority > 50 , \'label-warning\': page.task.priority < 50}"><span class="glyphicon glyphicon-flag"></span></span></div><div class="row desc"><div class="col-md-12"><span class="glyphicon glyphicon-align-justify"></span> <span ag-content="page.task.description" otherwisekey="NO_DESCRIPTION"></span></div></div></div></div></div><div class="row subRow"><div class="col-md-12 detailCol"><div class="tabsCon" ng-controller="TaskTabsCtrl" ng-init="page.task.refreshIdentityLinks();selectedTab=\'people\'"><uib-tabset class="tabset"><uib-tab select="selectedTab=\'people\'"><uib-tab-heading><i class="fa fa-group"></i> {{\'PEOPLE\' | translate}}</uib-tab-heading><div class="identity-link-con"><div class="identity-link authorImg"><img alt="profile" ag-user-pic="page.task.assignee"> <span ag-user="page.task.assignee" otherwisekey="NO_ASSIGNEE"></span><div class="identity-info"><span class="label label-primary"><span ag-identity-link-type="\'assignee\'"></span></span> <button ng-click="editIdentityLink(page.task, \'assignee\')" class="btn btn-warning label"><i class="glyphicon glyphicon-pencil"></i></button></div></div><div class="identity-link authorImg" ng-repeat="identityLink in page.task.identityLinks"><img alt="profile" ag-identity-link-pic="identityLink"> <span ag-identity-link-name="identityLink"></span><div class="identity-info"><span class="label label-info"><span ag-identity-link-type="identityLink.type"></span></span> <button ng-click="deleteIdentityLink(page.task, identityLink)" class="btn btn-danger label"><i class="glyphicon glyphicon-remove"></i></button></div></div></div></uib-tab><uib-tab select="page.task.refreshAttachments(); selectedTab=\'attachments\'"><uib-tab-heading><i class="glyphicon glyphicon-paperclip"></i> {{\'ATTACHMENTS\' | translate}}</uib-tab-heading><div class="rowsCon"><div class="row line-row img-row" ng-repeat="attachment in page.task.attachments"><div class="col-md-4" style="white-space: nowrap"><a target="_blank" ag-attachment="attachment"></a></div><div class="col-md-4" ag-content="attachment.description" otherwisekey="NO_DESCRIPTION"></div><div class="col-md-3 authorImg"><img alt="profile" ag-user-pic="attachment.userId"> <span ag-user="attachment.userId"></span></div><div class="col-md-1 edit-col"><button ng-click="deleteAttachment(page.task, attachment)" class="btn btn-danger label"><i class="glyphicon glyphicon-remove"></i></button></div></div><div class="emptyList" ng-if="page.task.attachments.length === 0"><span class="label label-default" translate="NO_ATTACHMENTS"></span></div></div></uib-tab><uib-tab select="page.task.refreshSubTasks();selectedTab = \'subtasks\'"><uib-tab-heading><i class="fa fa-tasks"></i> {{\'SUBTASKS\' | translate}}</uib-tab-heading><div class="rowsCon"><div class="row line-row" ng-repeat="subTask in page.task.subTasks"><div class="col-md-2">{{subTask.id}}</div><div class="col-md-6">{{subTask.name}}</div><div class="col-md-4 authorImg"><img alt="profile" ag-user-pic="subTask.assignee"> <span ag-user="subTask.assignee" otherwisekey="NO_ASSIGNEE"></span></div></div><div class="emptyList" ng-if="page.task.subTasks.length === 0"><span class="label label-default" translate="NO_SUBTASKS"></span></div></div></uib-tab><li class="edit tab-edit-con"><button ng-show="selectedTab === \'people\'" uib-tooltip="{{\'INVOLVE_TO_TASK\' | translate}}" ng-click="addIdentityLink(page.task)" class="btn btn-primary"><i class="glyphicon glyphicon-user"></i></button> <button ng-show="selectedTab === \'attachments\'" uib-tooltip="{{\'_ADD_ATTACHMENT\' | translate}}" ng-click="attach(page.task)" class="btn btn-primary"><i class="glyphicon glyphicon-paperclip"></i></button> <button ng-show="selectedTab === \'subtasks\'" uib-tooltip="{{\'NEW_SUB_TASK\' | translate}}" ng-click="newSubTask(page.task)" class="btn btn-primary"><i class="glyphicon glyphicon-plus"></i></button></li></uib-tabset></div></div></div><div class="row subRow"><div class="col-md-12 detailCol" ng-init="page.task.refreshVariables()"><div class="detail"><div class="edit"><button class="btn btn-primary" ng-click="page.showAddVar(page.task)"><i class="glyphicon glyphicon-plus"></i></button></div><div class="name">{{\'VARIABLES\' | translate}}</div><div class="varsCon rowsCon scollable-rows"><div class="row line-row simple-row" ng-repeat="variable in page.task.variables | orderBy:\'+name\'"><div class="col-md-4">{{variable.name}}</div><div class="col-md-7">{{variable.value | variable: variable.type}}</div><div class="col-md-1 edit-col"><button ng-click="page.showEditVar(page.task, variable)" class="btn btn-warning label"><i class="glyphicon glyphicon-pencil"></i></button></div></div><div class="emptyList" ng-if="page.task.variables.length === 0"><span class="label label-default" translate="NO_VARIABLES"></span></div></div></div></div></div></div><div class="col-md-5 colData" ng-init="page.task.refreshEvents()"><div class="detail"><button uib-tooltip="{{\'POST_COMMENT\' | translate}}" ng-click="page.postComment(page.task)" class="btn btn-primary edit"><span class="glyphicon glyphicon-comment"></span></button><div class="name">{{\'EVENTS\' | translate}}</div><div class="eventsList" ng-include="\'task/view/event.html\'"></div></div></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('task/view/itemControls.html',
    '<div class="col-md-2"><button class="btn btn-default" uib-tooltip="{{\'_BACK\' | translate}}" ng-click="page.back()"><i class="glyphicon glyphicon-chevron-left"></i></button> <button class="btn btn-default" uib-tooltip="{{\'_REFRESH\' | translate}}" ng-click="page.task.refresh()"><i class="glyphicon glyphicon-refresh"></i></button> <button ng-if="page.task.isAssignee" class="btn btn-success" ng-click="page.complete(page.task)" uib-tooltip="{{\'_COMPLETE\' | translate}}"><i class="glyphicon glyphicon-ok"></i></button> <button ng-if="!page.task.assignee && page.task.isCandidate" uib-tooltip="{{\'CLAIM\' | translate}}" class="btn btn-info" ng-click="page.claim(page.task)"><i class="glyphicon glyphicon-download-alt"></i></button></div><div class="col-md-8 hname"><div>{{page.task.id}} - {{page.task.name}}</div></div><div class="col-md-2 itemCount"></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('task/view/list.html',
    '<div ng-if="page.list.total === 0" class="noList"><h3><span class="label label-default" translate="NO_TASKS"></span></h3></div><div ng-repeat="task in page.list" class="detail"><div class="row name header-row"><div class="col-md-6 name-col"><a href="#/tasks/{{page.section}}/{{task.id}}">{{task.id}} - {{task.name}}</a> <a href="#/tasks/{{page.section}}/{{task.id}}" class="btn btn-primary btn-xs">详情 <span class="glyphicon glyphicon-zoom-in"></span></a></div><div class="col-md-6 edit-col"><span class="label label-default"><span class="glyphicon glyphicon-time"></span> <span ag-ago="task.createTime" translatekey="CREATED_AGO"></span></span> <span ng-if="task.processInstanceId" class="label label-info"><span class="glyphicon glyphicon-random"></span> {{task.processInstanceId}} - {{task.processDefinitionId | definitionName}}</span> <span class="label" ng-class="{\'label-success\': task.priority === 50 ,\'label-danger\': task.priority > 50 , \'label-warning\': task.priority < 50}"><span class="glyphicon glyphicon-flag"></span></span></div></div><div class="row line-row"><div class="col-md-3 authorImg"><img alt="profile" ag-user-pic="task.assignee"> <span ag-user="task.assignee" otherwisekey="NO_ASSIGNEE"></span></div><div class="col-md-3"><span class="glyphicon glyphicon-calendar"></span> <span ag-ago="task.dueDate" otherwisekey="NO_DUE" translatekey="DUE_AGO"></span></div><div ng-if="task.category" class="col-md-3"><span class="glyphicon glyphicon-tag"></span><span>{{task.category}}</span></div></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('task/view/listControls.html',
    '<div class="col-xs-6"><button class="btn btn-default" uib-tooltip="{{\'_REFRESH\' | translate}}" ng-click="page.refresh()"><i class="glyphicon glyphicon-refresh"></i></button><div class="btn-group abtn-group" uib-dropdown ng-init="sortBy={isopen:false}" is-open="sortBy.isopen"><button type="button" class="btn btn-default sort-btn" ng-disabled="disabled" ag-click="sortBy.isopen=!sortBy.isopen;"><span class="glyphicon glyphicon-sort"></span> {{\'SORT_BY_\'+page.sortKey | translate}}</button> <button type="button" class="btn btn-default" ag-click="page.toggleOrder()"><span class="glyphicon" ng-class="{\'glyphicon-sort-by-attributes\': page.requestParam.order === \'asc\' ,\'glyphicon-sort-by-attributes-alt\': page.requestParam.order === \'desc\'}"></span></button><ul class="dropdown-menu" role="menu"><li ng-repeat="(key, value) in page.sortKeys" ng-if="value !== page.sortKey"><a href ng-click="sortBy.isopen=false;page.sortBy(key)" translate="{{\'SORT_BY_\'+value}}"></a></li></ul></div></div><div class="col-xs-6 itemCount" ng-include="\'common/view/itemsNav.html\'"></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('process/view/definition/list.html',
    '<div ng-if="page.list.total === 0" class="noList"><h3><span class="label label-default" translate="NO_DEFINITIONS"></span></h3></div><div ng-repeat="definition in page.list" class="detail"><div class="row name header-row"><div class="col-md-6 name-col">{{definition.id}} - {{definition.name}} <button uib-tooltip="{{\'START_PROCESS\' | translate}}" ng-click="page.start(definition)" class="btn btn-primary btn-xs">{{\'START_PROCESS\' | translate}}<span class="glyphicon glyphicon-play"></span></button></div><div class="col-md-6 edit-col"></div></div><div class="row desc"><div class="col-md-12"><span class="glyphicon glyphicon-align-justify"></span> <span ag-content="definition.description" otherwisekey="NO_DESCRIPTION"></span></div></div><div class="diagram" ag-definition-diagram="definition" otherwisekey="NO_DIAGRAM"></div></div>');
}]);
})();

(function(module) {
try {
  module = angular.module('act-ui');
} catch (e) {
  module = angular.module('act-ui', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('process/view/definition/listControls.html',
    '<div class="col-md-9"><button class="btn btn-default" uib-tooltip="{{\'_REFRESH\' | translate}}" ng-click="page.refresh()"><i class="glyphicon glyphicon-refresh"></i></button></div><div class="col-md-3 itemCount" ng-include="\'common/view/itemsNav.html\'"></div>');
}]);
})();
