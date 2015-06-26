'use strict';

angular
  .module('boursesApp', [
    'ngCookies',
    'ngResource',
    'ngSanitize',
    'ui.router',
    'ui.bootstrap',
    'angular-storage',
    'ngMessages',
    'angular-ladda',
    'angular-capitalize-filter',
    'mm.iban'
  ])
  .config(function ($urlRouterProvider, $locationProvider, $urlMatcherFactoryProvider, $httpProvider) {
    moment.locale('fr');
    $urlRouterProvider.otherwise('/');
    $locationProvider.html5Mode(true);
    $urlMatcherFactoryProvider.strictMode(false);
    $httpProvider.interceptors.push('authInterceptor');
  })

  .factory('authInterceptor', function ($rootScope, $q, $cookieStore, $location) {
    return {
      // Add authorization token to headers
      request: function (config) {
        config.headers = config.headers || {};
        if ($cookieStore.get('loginToken')) {
          config.headers.Authorization = 'Bearer ' + $cookieStore.get('loginToken');
        }
        return config;
      },

      // Intercept 401s and redirect you to login
      responseError: function(response) {
        if(response.status === 401 && response.message) {
          // $location.path('/login');
          // remove any stale tokens
          $cookieStore.remove('loginToken');
          return $q.reject(response);
        }
        else {
          return $q.reject(response);
        }
      }
    };
  })

  .run(function ($rootScope, $state, Auth) {
    // Redirect to login if route requires auth and you're not logged in
    $rootScope.$on('$stateChangeStart', function (event, toState, toStateParams) {
      Auth.isLoggedInAsync(function(loggedIn) {
        if (toState.authenticate && !loggedIn) {
          $rootScope.returnToState = toState;
          $rootScope.returnToStateParams = toStateParams;

          event.preventDefault();
          $state.go('layout.login');
        }
      });
    });
  });
