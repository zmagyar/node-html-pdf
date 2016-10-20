var path = require('path');
var fs = require('fs');

var Promise = require('bluebird');
var BlueBirdQueue = require('bluebird-queue');
var childprocess = require('child_process');
var ps = require('ps-node');

try {
    var phantomjs = require('phantomjs-prebuilt');
} catch (err) {
    console.log('html-pdf: Failed to load PhantomJS module.', err);
}

var queue = new BlueBirdQueue({
    concurrency: 1
});

var child;
/**
 * Get PDF file path by given HTML source.
 * The method uses a bluebird-queue to process the requests after each other
 * while keeping the same phantomjs process alive.
 *
 * @param html
 * @param id
 * @returns {bluebird|exports|module.exports}
 */
var getPdf = function (html, id) {
    id = id || parseInt(Math.random() * 10000000);
    return new Promise(function (resolve, reject) {
        var promise = function () {


            return _findPhantomProcess()
                .then(function () {
                    return _sendDataToPhantomProcess(html, {
                        id: id
                    });
                })
                .then(function (pdfData) {
                    if (pdfData.id === id) {
                        resolve(pdfData);
                    } else {
                        reject(new Error('PDF generation error'));
                    }
                })
                .catch(reject);
        };
        queue.addNow(promise);
    });
};

/**
 * Kill phantomjs process if process exits.
 */
process.on('exit', function () {
    if (child) {
        child.kill();
    }
});


var _getChildProcesses = function (path, args) {
    return new Promise(function (resolve, reject) {
        ps.lookup({
            command: path,
            psargs: 'axw',
            arguments: args.join(' '),
        }, function (err, resultList) {
            if (err) {
                throw new Error(err);
            }
            resolve(resultList);
        });
    });
}

/**
 * Start phantomjs process
 * @returns {*}
 * @private
 */
var _startPhantomProcess = function () {
    var scriptPath = path.join(__dirname, 'scripts', 'pdf_a4_portrait.js');
    var phantomPath = phantomjs.path;

    return _getChildProcesses(phantomPath, [scriptPath])
        .each(function (phantomProcess) {
            return _killPhantomProcess(phantomProcess);
        })
        .then(function () {

            child = childprocess.spawn(phantomPath, [scriptPath]);


            child.stdout.on('data', function (buffer) {
                var data = buffer.toString();
                console.log(data);
            });

            var interval = setInterval(function () {
                try {
                    child.stdin.write('\n', 'utf8');
                } catch (err) {
                    if (typeof child.kill === 'function') {
                        console.log(err);
                        clearInterval(interval);
                        child.kill();
                    }
                    child.killed = true;
                }
            }, 100);


            child.on('error', function (error) {
                console.log(error);
                child.killed = true;
            });

            return child;


        });


};

var _killPhantomProcess = function (phantomProcess) {
    return new Promise(function (resolve, reject) {
        ps.kill(phantomProcess.pid, function (err) {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
};

var _findPhantomProcess = function () {
    if (!child || child.killed) {
        return _startPhantomProcess();
    } else {
        return Promise.resolve(child);
    }
}

/**
 * Send data to phantom process
 * @param html
 * @param options
 * @returns {bluebird|exports|module.exports}
 * @private
 */
var _sendDataToPhantomProcess = function (html, options) {


    return new Promise(function (resolve, reject) {
        var errorHandler = function (buffer) {
            var data = buffer.toString();
            console.log('PhantomJS process error: ', data);
            reject(new Error('PhantomJS process error.'));
            child.kill();
        };

        var dataHandler = function (buffer) {
            var data = buffer.toString();
            try {
                var jsonData = JSON.parse(data);
                if (jsonData.filename) {
                    resolve(jsonData);
                    child.stdout.removeListener('data', dataHandler);
                    child.stderr.removeListener('data', errorHandler);
                }
            } catch (err) {
                console.log('ccc', err);
            }
        };


        child.once('exit', function (error) {
            reject(new Error('Child process exited.'));
        });


        child.stdin.write(JSON.stringify({
                html: html,
                options: options
            }) + '\n', 'utf8');

        child.stdout.on('data', dataHandler);
        child.stderr.on('data', errorHandler);
    });
};

module.exports.getPdf = getPdf;
