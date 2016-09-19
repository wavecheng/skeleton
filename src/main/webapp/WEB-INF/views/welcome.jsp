<%@ page pageEncoding="utf-8" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<c:set var="contextPath" value="${pageContext.request.contextPath}" />

<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8"/>
    <title>Act Demo</title>
    <!-- inject:vendor:css -->
    <link rel="stylesheet" href="${contextPath}/resources/css/vendors.min.css">
    <!-- endinject -->
    <!-- inject:css -->
    <link rel="stylesheet" href="${contextPath}/resources/css/act-ui.min.css">
    <!-- endinject -->
      <style id="localeCss" type="text/css">
      </style>
    <link rel="shortcut icon" href="${contextPath}/resources/Images/favicon.ico" type="image/x-icon">
  </head>

  <body>
      <div id="loading" align="center">
          <div class="load-spinner">
              <div class="bounce1"></div>
              <div class="bounce2"></div>
              <div class="bounce3"></div>
          </div>
      </div>

      <div ng-if="currentUser" id="main" ng-include="'core/view/main.html'">
      </div>
    <!-- inject:vendor:js -->
    <script src="${contextPath}/resources/js/vendors.min.js"></script>
    <!-- endinject -->
    <!-- inject:js -->
    <script src="${contextPath}/resources/js/act-ui.js"></script>
    <!-- endinject -->

    <script>
        angular.element(document).ready(function() {
            angular.bootstrap(document, ['act'], {strictDi: true});

            var loading = document.getElementById('loading');

            loading.parentNode.removeChild(loading);
        });
    </script>
  </body>
</html>
