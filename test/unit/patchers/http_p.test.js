var assert = require('chai').assert;
var expect = require('chai').expect;
var chai = require('chai');
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
var url = require('url');
var events = require('events');

var captureHTTPs = require('../../../lib/patchers/http_p').captureHTTPs;
var captureHTTPsGlobal = require('../../../lib/patchers/http_p').captureHTTPsGlobal;
var contextUtils = require('../../../lib/context_utils');
var Utils = require('../../../lib/utils');
var Segment = require('../../../lib/segments/segment');
var TestEmitter = require('../test_utils').TestEmitter;

chai.should();
chai.use(sinonChai);

var buildFakeRequest = function() {
  var request = new TestEmitter();
  request.method = 'GET';
  request.url = '/';
  request.connection = { remoteAddress: 'myhost' };
  return request;
};

var buildFakeResponse = function() {
  var response = new TestEmitter();
  response.resume = function() {
    response.emit('resume');
  };
  return response;
};

describe('HTTP/S', function() {
  describe('patchers', function () {
    var httpClient;

    beforeEach(function() {
      httpClient = {
        request: function request() {},
        get: function get() {}
      };
    });

    describe('#captureHTTPs', function() {
      it('should create a copy of the module', function() {
        var capturedHttp = captureHTTPs(httpClient, true);
        assert.notEqual(httpClient, capturedHttp);
      });

      it('should stub out the request method for the capture one', function() {
        var capturedHttp = captureHTTPs(httpClient, true);
        assert.equal(capturedHttp.request.name, 'captureHTTPsRequest');
        assert.equal(capturedHttp.__request.name, 'request');
      });

      it('should stub out the get method for the capture one', function() {
        var capturedHttp = captureHTTPs(httpClient, true);
        assert.equal(capturedHttp.get.name, 'captureHTTPsGet');
        assert.equal(capturedHttp.__get.name, 'get');
      });
    });

    describe('#captureHTTPsGlobal', function() {
      let httpOptions, newSubsegmentStub, sandbox, segment;

      beforeEach(function() {
        sandbox = sinon.createSandbox();
        segment = new Segment('test');
        newSubsegmentStub = sandbox.spy(segment, 'addNewSubsegment');
        httpOptions = {
          host: 'myhost',
          path: '/'
        };
      });

      afterEach(function() {
        sandbox.restore();
      });

      it('should stub out the request method for the capture one', function() {
        captureHTTPsGlobal(httpClient, true);
        assert.equal(httpClient.request.name, 'captureHTTPsRequest');
        assert.equal(httpClient.__request.name, 'request');
      });

      it('should stub out the get method for the capture one', function() {
        captureHTTPsGlobal(httpClient, true);
        assert.equal(httpClient.get.name, 'captureHTTPsGet');
        assert.equal(httpClient.__get.name, 'get');
      });

      it('should not create a subsegment when using uninstrumented client', function() {
        captureHTTPsGlobal(httpClient, true);

        httpClient.__request(httpOptions, () => {});

        expect(newSubsegmentStub).not.to.be.called;
      });
    });
  });

  describe('#captureHTTPsRequest', function() {
    var addRemoteDataStub, closeStub, httpOptions, newSubsegmentStub, resolveManualStub, sandbox, segment, subsegment;
    var traceId = '1-57fbe041-2c7ad569f5d6ff149137be86';

    beforeEach(function() {
      sandbox = sinon.createSandbox();
      segment = new Segment('test', traceId);
      subsegment = segment.addNewSubsegment('testSub');

      newSubsegmentStub = sandbox.stub(segment, 'addNewSubsegment').returns(subsegment);

      resolveManualStub = sandbox.stub(contextUtils, 'resolveManualSegmentParams');
      sandbox.stub(contextUtils, 'isAutomaticMode').returns(true);
      addRemoteDataStub = sandbox.stub(subsegment, 'addRemoteRequestData').returns();
      closeStub = sandbox.stub(subsegment, 'close').returns();

      httpOptions = {
        host: 'myhost',
        path: '/'
      };
    });

    afterEach(function() {
      sandbox.restore();
    });

    describe('#withContextAvailable', () => {
      beforeEach(() => {
        sandbox.stub(contextUtils, 'resolveSegment').returns(segment);
      });

      afterEach(() => {
        sandbox.restore();
      });

      describe('on invocation', function() {
        var capturedHttp, fakeRequest, fakeResponse, httpClient, requestSpy, resumeSpy, sandbox;

        beforeEach(function() {
          sandbox = sinon.createSandbox();
          segment = new Segment('test', traceId);

          fakeRequest = buildFakeRequest();
          fakeResponse = buildFakeResponse();
          fakeResponse.req = fakeRequest;

          httpClient = { request: function(...args) {
            const callback = args[typeof args[1] === 'object' ? 2 : 1];
            callback(fakeResponse);
            return fakeRequest;
          }};
          httpClient.get = httpClient.request;

          resumeSpy = sandbox.spy(fakeResponse, 'resume');
          requestSpy = sandbox.spy(httpClient, 'request');
          capturedHttp = captureHTTPs(httpClient, true);
        });

        afterEach(function() {
          sandbox.restore();
        });

        it('should call to resolve any manual params', function() {
          var options = {hostname: 'hostname', path: '/'};
          capturedHttp.request(options);

          resolveManualStub.should.have.been.calledWith(options);
        });

        it('should consume the response if no callback is provided by user', function() {
          capturedHttp.request(httpOptions);  // no callback
          resumeSpy.should.have.been.calledOnce;
        });

        it('should not consume the response if a callback is provided by user', function() {
          capturedHttp.request(httpOptions, () => {});
          resumeSpy.should.not.have.been.called;
        });

        it('should not consume the response if a response listener is provided by user', function() {
          fakeRequest.on('response', () => {});
          capturedHttp.request(httpOptions);
          resumeSpy.should.not.have.been.called;
        });

        it('should create a new subsegment with name as hostname', function() {
          var options = {hostname: 'hostname', path: '/'};
          capturedHttp.request(options);
          newSubsegmentStub.should.have.been.calledWith(options.hostname);
        });

        it('should create a new subsegment with name as host when hostname is missing', function() {
          capturedHttp.request(httpOptions);
          newSubsegmentStub.should.have.been.calledWith(httpOptions.host);
        });

        it('should create a new subsegment with name as "Unknown host" when host and hostname is missing', function() {
          capturedHttp.request({path: '/'});
          newSubsegmentStub.should.have.been.calledWith('Unknown host');
        });

        it('should pass when a string is passed', function() {
          capturedHttp.request('http://hostname/api');
          newSubsegmentStub.should.have.been.calledWith('hostname');
          capturedHttp.get('http://hostname/api');
          newSubsegmentStub.should.have.been.calledWith('hostname');
        });

        it('should pass when a URL is passed', function() {
          var options = new url.URL('http://hostname/api');
          capturedHttp.request(options);
          newSubsegmentStub.should.have.been.calledWith('hostname');
        });

        it('should call the base method', function() {
          capturedHttp.request({'Segment': segment});
          assert(requestSpy.called);
        });

        it('should attach an event handler to the "end" event', function() {
          capturedHttp.request(httpOptions);
          assert.isFunction(fakeResponse._events.end);
        });

        it('should inject the tracing headers', function() {
          capturedHttp.request(httpOptions);

          // example: 'Root=1-59138384-82ff54d5ba9282f0c680adb3;Parent=53af362e4e4efeb8;Sampled=1'
          var xAmznTraceId = new RegExp('^Root=' + traceId + ';Parent=([a-f0-9]{16});Sampled=1$');
          var options = requestSpy.firstCall.args[0];
          assert.match(options.headers['X-Amzn-Trace-Id'], xAmznTraceId);
        });

        it('should inject the tracing headers into the options if a URL is also provided', function() {
          capturedHttp.request(`http://${httpOptions.host}${httpOptions.path}`, httpOptions);

          // example: 'Root=1-59138384-82ff54d5ba9282f0c680adb3;Parent=53af362e4e4efeb8;Sampled=1'
          var xAmznTraceId = new RegExp('^Root=' + traceId + ';Parent=([a-f0-9]{16});Sampled=1$');
          var options = requestSpy.firstCall.args[1];
          assert.match(options.headers['X-Amzn-Trace-Id'], xAmznTraceId);
        });

        it('should return the request object', function() {
          var request = capturedHttp.request(httpOptions);
          assert.equal(request, fakeRequest);
        });
      });



      describe('on the "end" event', function() {
        var capturedHttp, fakeRequest, fakeResponse, httpClient, sandbox;

        beforeEach(function() {
          sandbox = sinon.createSandbox();

          fakeRequest = buildFakeRequest();
          fakeResponse = buildFakeResponse();
          // We need to manually link resume and end to mimic the real response
          // per https://nodejs.org/api/http.html#http_class_http_clientrequest
          fakeResponse.resume = function() {
            fakeResponse.emit('end');
          };

          httpClient = { request: function(options, callback) {
            fakeResponse.req = fakeRequest;
            callback(fakeResponse);
            return fakeRequest;
          }};

          capturedHttp = captureHTTPs(httpClient);
        });

        afterEach(function() {
          sandbox.restore();
          delete segment.notTraced;
        });

        it('should not set "http.traced" if the enableXRayDownstream flag is not set', function(done) {
          fakeResponse.statusCode = 200;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            addRemoteDataStub.should.have.been.calledWithExactly(fakeRequest, fakeResponse, false);
            done();
          }, 50);
        });

        it('should set "http.traced" on the subsegment if the root is sampled and enableXRayDownstream is set', function(done) {
          capturedHttp = captureHTTPs(httpClient, true);
          fakeResponse.statusCode = 200;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            addRemoteDataStub.should.have.been.calledWithExactly(fakeRequest, fakeResponse, true);
            done();
          }, 50);
        });

        it('should call any custom subsegment callback', function(done) {
          var subsegmentCallback = sandbox.spy();
          capturedHttp = captureHTTPs(httpClient, true, subsegmentCallback);
          fakeResponse.statusCode = 200;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            subsegmentCallback.should.have.been.calledWithExactly(subsegment, fakeRequest, fakeResponse);
            done();
          }, 50);
        });

        it('should close the subsegment', function(done) {
          fakeResponse.statusCode = 200;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            closeStub.should.have.been.calledWithExactly();
            done();
          }, 50);
        });

        it('should flag the subsegment as throttled if status code 429 is seen', function(done) {
          var addThrottleStub = sandbox.stub(subsegment, 'addThrottleFlag');

          fakeResponse.statusCode = 429;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            addThrottleStub.should.have.been.calledOnce;
            done();
          }, 50);
        });

        it('should check the cause of the http status code', function(done) {
          var utilsCodeStub = sandbox.stub(Utils, 'getCauseTypeFromHttpStatus');

          fakeResponse.statusCode = 500;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            utilsCodeStub.should.have.been.calledWith(fakeResponse.statusCode);
            done();
          }, 50);
        });
      });

      describe('when the request "error" event fires', function() {
        var capturedHttp, error, fakeRequest, httpClient, req, sandbox, subsegmentCallback;

        beforeEach(function() {
          sandbox = sinon.createSandbox();

          httpClient = { request: function() {} };

          subsegmentCallback = sandbox.spy();
          capturedHttp = captureHTTPs(httpClient, null, subsegmentCallback);

          fakeRequest = buildFakeRequest();

          sandbox.stub(capturedHttp, '__request').returns(fakeRequest);
          error = {};

          req = capturedHttp.request(httpOptions);
        });

        afterEach(function() {
          sandbox.restore();
        });

        // (request -> ECONNREFUSED -> error event).
        // The way I verify if 'end' fired is if the subsegment.http.response was captured on the alternate code path.
        // The only way to trigger this is a ECONNREFUSED error, as it is the only event which fires and has no response object.

        it('should capture the request ECONNREFUSED error', function(done) {
          fakeRequest.on('error', function() {});
          fakeRequest.emit('error', error);

          setTimeout(function() {
            addRemoteDataStub.should.have.been.calledWith(req);
            closeStub.should.have.been.calledWithExactly(error);
            subsegmentCallback.should.have.been.calledWithExactly(subsegment, fakeRequest, null, error);
            done();
          }, 50);
        });

        // (request -> end event, then if error -> error event)
        // sets subsegment.http = { response: { status: 500 }} to set the state that the 'end' event fired.

        it('should capture the request code error', function(done) {
          subsegment.http = { response: { status: 500 }};
          fakeRequest.on('error', function() {});
          fakeRequest.emit('error', error);

          setTimeout(function() {
            closeStub.should.have.been.calledWithExactly(error, true);
            done();
          }, 50);
        });

        it('should re-emit the error if unhandled', function() {
          assert.throws(function() {
            fakeRequest.emitter.emit('error', error);
          });
        });

        it('should call any custom subsegment callback', function(done) {
          fakeRequest.on('error', function() {});
          fakeRequest.emit('error', error);

          setTimeout(function() {
            subsegmentCallback.should.have.been.calledWithExactly(subsegment, fakeRequest, null, error);
            done();
          }, 50);
        });

        if (process.version.startsWith('v') && process.version >= 'v12.17') {
          it('should still re-emit if there are multiple errorMonitors attached', function() {
            fakeRequest.on(events.errorMonitor, function() {});
            fakeRequest.on(events.errorMonitor, function() {});

            assert.throws(function() {
              fakeRequest.emitter.emit('error', error);
            });
          });
        }
      });
    });

    describe('#withoutContextAvailable', function() {
      let capturedHttp, httpClient, fakeRequest;
      beforeEach(() => {
        fakeRequest = {'foo': 'bar'};
        httpClient = { request: () => {
          return fakeRequest;
        }};
        capturedHttp = captureHTTPs(httpClient, true);
        sandbox.stub(contextUtils, 'resolveSegment').returns(null);
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('should return the original request without making a subsegment', () => {
        const request = capturedHttp.request(new url.URL('http://amazon.com'));
        assert.equal(request, fakeRequest);
        expect(newSubsegmentStub).not.to.be.called;
      });
    });
  });




  describe('#captureHTTPsRequest - Unsampled', function() {
    var addRemoteDataStub, closeStub, httpOptions, newSubsegmentStub, resolveManualStub, sandbox, segment, subsegment, httpRequest, addNewRequestSubsegmentStub, stubResolve, addNewSubsegmentStub;
    var traceId = '1-57fbe041-2c7ad569f5d6ff149137be86';

    beforeEach(function() {
      sandbox = sinon.createSandbox();
      segment = new Segment('testSegment', traceId);
      subsegment = segment.addNewSubsegmentWithoutSampling('subseg');
      httpRequest = subsegment.addNewSubsegmentWithoutSampling('http-request');

      // stubResolve = sandbox.stub(contextUtils, 'resolveSegment').returns(subsegment);
      addNewSubsegmentStub = sandbox.stub(segment, 'addNewSubsegmentWithoutSampling').returns(subsegment);
      addNewRequestSubsegmentStub = sandbox.stub(subsegment, 'addNewSubsegmentWithoutSampling').returns(httpRequest);

      resolveManualStub = sandbox.stub(contextUtils, 'resolveManualSegmentParams');
      sandbox.stub(contextUtils, 'isAutomaticMode').returns(true);
      addRemoteDataStub = sandbox.stub(subsegment, 'addRemoteRequestData').returns();
      closeStub = sandbox.stub(httpRequest, 'close').returns();

      httpOptions = {
        host: 'myhost',
        path: '/'
      };
    });

    afterEach(function() {
      sandbox.restore();
    });

    describe('#withContextAvailable', () => {
      beforeEach(() => {
        sandbox.stub(contextUtils, 'resolveSegment').returns(subsegment);
      });
      afterEach(() => {
        sandbox.restore();
      });

      describe('on invocation', function() {
        var capturedHttp, fakeRequest, fakeResponse, httpClient, requestSpy, resumeSpy, sandbox;

        beforeEach(function() {
          sandbox = sinon.createSandbox();
          segment = new Segment('test', traceId);

          fakeRequest = buildFakeRequest();
          fakeResponse = buildFakeResponse();
          fakeResponse.req = fakeRequest;

          httpClient = { request: function(...args) {
            const callback = args[typeof args[1] === 'object' ? 2 : 1];
            callback(fakeResponse);
            return fakeRequest;
          }};
          httpClient.get = httpClient.request;

          resumeSpy = sandbox.spy(fakeResponse, 'resume');
          requestSpy = sandbox.spy(httpClient, 'request');
          capturedHttp = captureHTTPs(httpClient, true);
        });

        afterEach(function() {
          sandbox.restore();
        });

        it('should call to resolve any manual params', function() {
          var options = {hostname: 'hostname', path: '/'};
          capturedHttp.request(options);

          resolveManualStub.should.have.been.calledWith(options);
        });

        it('should consume the response if no callback is provided by user', function() {
          capturedHttp.request(httpOptions);  // no callback
          resumeSpy.should.have.been.calledOnce;
        });

        it('should not consume the response if a callback is provided by user', function() {
          capturedHttp.request(httpOptions, () => {});
          resumeSpy.should.not.have.been.called;
        });

        it('should not consume the response if a response listener is provided by user', function() {
          fakeRequest.on('response', () => {});
          capturedHttp.request(httpOptions);
          resumeSpy.should.not.have.been.called;
        });

        it('should create a new subsegment with name as hostname', function() {
          var options = {hostname: 'hostname', path: '/'};
          capturedHttp.request(options);
          addNewRequestSubsegmentStub.should.have.been.calledWith(options.hostname);
        });

        it('should create a new subsegment with name as host when hostname is missing', function() {
          capturedHttp.request(httpOptions);
          addNewRequestSubsegmentStub.should.have.been.calledWith(httpOptions.host);
        });

        it('should create a new subsegment with name as "Unknown host" when host and hostname is missing', function() {
          capturedHttp.request({path: '/'});
          addNewRequestSubsegmentStub.should.have.been.calledWith('Unknown host');
        });

        it('should pass when a string is passed', function() {
          capturedHttp.request('http://hostname/api');
          addNewRequestSubsegmentStub.should.have.been.calledWith('hostname');
          capturedHttp.get('http://hostname/api');
          addNewRequestSubsegmentStub.should.have.been.calledWith('hostname');
        });

        it('should pass when a URL is passed', function() {
          var options = new url.URL('http://hostname/api');
          capturedHttp.request(options);
          addNewRequestSubsegmentStub.should.have.been.calledWith('hostname');
        });

        it('should call the base method', function() {
          capturedHttp.request({'Segment': segment});
          assert(requestSpy.called);
        });

        it('should attach an event handler to the "end" event', function() {
          capturedHttp.request(httpOptions);
          assert.isFunction(fakeResponse._events.end);
        });

        it('should inject the tracing headers', function() {
          capturedHttp.request(httpOptions);

          // example: 'Root=1-59138384-82ff54d5ba9282f0c680adb3;Parent=53af362e4e4efeb8;Sampled=1'
          var xAmznTraceId = new RegExp('^Root=' + traceId + ';Parent=([a-f0-9]{16});Sampled=0$');
          var options = requestSpy.firstCall.args[0];
          assert.match(options.headers['X-Amzn-Trace-Id'], xAmznTraceId);
        });

        it('should inject the tracing headers into the options if a URL is also provided', function() {
          capturedHttp.request(`http://${httpOptions.host}${httpOptions.path}`, httpOptions);

          // example: 'Root=1-59138384-82ff54d5ba9282f0c680adb3;Parent=53af362e4e4efeb8;Sampled=1'
          var xAmznTraceId = new RegExp('^Root=' + traceId + ';Parent=([a-f0-9]{16});Sampled=0$');
          var options = requestSpy.firstCall.args[1];
          assert.match(options.headers['X-Amzn-Trace-Id'], xAmznTraceId);
        });

        it('should return the request object', function() {
          var request = capturedHttp.request(httpOptions);
          assert.equal(request, fakeRequest);
        });
      });



      describe('on the "end" event', function() {
        var capturedHttp, fakeRequest, fakeResponse, httpClient, sandbox;

        beforeEach(function() {
          sandbox = sinon.createSandbox();

          fakeRequest = buildFakeRequest();
          fakeResponse = buildFakeResponse();
          // We need to manually link resume and end to mimic the real response
          // per https://nodejs.org/api/http.html#http_class_http_clientrequest
          fakeResponse.resume = function() {
            fakeResponse.emit('end');
          };

          httpClient = { request: function(options, callback) {
            fakeResponse.req = fakeRequest;
            callback(fakeResponse);
            return fakeRequest;
          }};

          capturedHttp = captureHTTPs(httpClient);
        });

        afterEach(function() {
          sandbox.restore();
          delete segment.notTraced;
        });

        it('should not set "http.traced" if the enableXRayDownstream flag is not set', function(done) {
          fakeResponse.statusCode = 200;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            addRemoteDataStub.should.not.have.been.called;
            done();
          }, 50);
        });
        // });

        it('should not set "http.traced" on the subsegment if the root is unsampled', function(done) {
          capturedHttp = captureHTTPs(httpClient, true);
          fakeResponse.statusCode = 200;
          capturedHttp.request(httpOptions);
          // });

          setTimeout(function() {
            addRemoteDataStub.should.not.have.been.called;
            done();
          }, 50);
        });

        it('should call any custom subsegment callback', function(done) {
          var subsegmentCallback = sandbox.spy();
          capturedHttp = captureHTTPs(httpClient, true, subsegmentCallback);
          fakeResponse.statusCode = 200;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            subsegmentCallback.should.have.been.calledWithExactly(httpRequest, fakeRequest, fakeResponse);
            done();
          }, 50);
        });

        it('should close the subsegment', function(done) {
          fakeResponse.statusCode = 200;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            closeStub.should.have.been.calledWithExactly();
            done();
          }, 50);
        });

        it('should flag the subsegment as throttled if status code 429 is seen', function(done) {
          var addThrottleStub = sandbox.stub(httpRequest, 'addThrottleFlag');

          fakeResponse.statusCode = 429;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            addThrottleStub.should.have.been.calledOnce;
            done();
          }, 50);
        });

        it('should check the cause of the http status code', function(done) {
          var utilsCodeStub = sandbox.stub(Utils, 'getCauseTypeFromHttpStatus');

          fakeResponse.statusCode = 500;
          capturedHttp.request(httpOptions);

          setTimeout(function() {
            utilsCodeStub.should.have.been.calledWith(fakeResponse.statusCode);
            done();
          }, 50);
        });
      });

      describe('when the request "error" event fires', function() {
        var capturedHttp, error, fakeRequest, httpClient, req, sandbox, subsegmentCallback;

        beforeEach(function() {
          sandbox = sinon.createSandbox();

          httpClient = { request: function() {} };

          subsegmentCallback = sandbox.spy();
          capturedHttp = captureHTTPs(httpClient, null, subsegmentCallback);

          fakeRequest = buildFakeRequest();

          sandbox.stub(capturedHttp, '__request').returns(fakeRequest);
          error = {};

          req = capturedHttp.request(httpOptions);
        });

        afterEach(function() {
          sandbox.restore();
        });

        // (request -> ECONNREFUSED -> error event).
        // The way I verify if 'end' fired is if the subsegment.http.response was captured on the alternate code path.
        // The only way to trigger this is a ECONNREFUSED error, as it is the only event which fires and has no response object.

        it('should capture the request ECONNREFUSED error', function(done) {
          fakeRequest.on('error', function() {});
          fakeRequest.emit('error', error);

          setTimeout(function() {
            addRemoteDataStub.should.not.have.been.called;
            closeStub.should.have.been.calledWithExactly(error);
            subsegmentCallback.should.have.been.calledWithExactly(httpRequest, fakeRequest, null, error);
            done();
          }, 50);
        });

        // (request -> end event, then if error -> error event)
        // sets subsegment.http = { response: { status: 500 }} to set the state that the 'end' event fired.

        it('should capture the request code error', function(done) {
          subsegment.http = { response: { status: 500 }};
          fakeRequest.on('error', function() {});
          fakeRequest.emit('error', error);

          setTimeout(function() {
            closeStub.should.have.been.calledWithExactly(error);
            done();
          }, 50);
        });

        it('should re-emit the error if unhandled', function() {
          assert.throws(function() {
            fakeRequest.emitter.emit('error', error);
          });
        });

        it('should call any custom subsegment callback', function(done) {
          fakeRequest.on('error', function() {});
          fakeRequest.emit('error', error);

          setTimeout(function() {
            subsegmentCallback.should.have.been.calledWithExactly(httpRequest, fakeRequest, null, error);
            done();
          }, 50);
        });

        if (process.version.startsWith('v') && process.version >= 'v12.17') {
          it('should still re-emit if there are multiple errorMonitors attached', function() {
            fakeRequest.on(events.errorMonitor, function() {});
            fakeRequest.on(events.errorMonitor, function() {});

            assert.throws(function() {
              fakeRequest.emitter.emit('error', error);
            });
          });
        }
      });
    });

    describe('#withoutContextAvailable', function() {
      let capturedHttp, httpClient, fakeRequest;
      beforeEach(() => {
        fakeRequest = {'foo': 'bar'};
        httpClient = { request: () => {
          return fakeRequest;
        }};
        capturedHttp = captureHTTPs(httpClient, true);
        sandbox.stub(contextUtils, 'resolveSegment').returns(null);
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('should return the original request without making a subsegment', () => {
        const request = capturedHttp.request(new url.URL('http://amazon.com'));
        assert.equal(request, fakeRequest);
        expect(addNewRequestSubsegmentStub).not.to.be.called;
      });
    });
  });
});
