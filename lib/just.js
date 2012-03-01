/*!
 * JUST JavaScript template engine v0.1.2
 * https://github.com/baryshev/just
 *
 * Copyright 2012, Vadim M. Baryshev <vadimbaryshev@gmail.com>
 * Licensed under the MIT license
 * https://github.com/baryshev/just/LICENSE
 *
 * Includes parts of async
 * https://github.com/caolan/async
 * Copyright 2010 Caolan McMahon
 * Released under the MIT license
 *
 * Includes parts of node
 * https://github.com/joyent/node
 * Copyright Joyent, Inc. and other Node contributors
 * Released under the MIT license
 */ (function () { var fs, path; var async = function() {
	var async = {};
	var _forEach = function (arr, iterator) {
		if (arr.forEach) {
			return arr.forEach(iterator);
		}
		for (var i = 0; i < arr.length; i += 1) {
			iterator(arr[i], i, arr);
		}
	};
	var _map = function (arr, iterator) {
		if (arr.map) {
			return arr.map(iterator);
		}
		var results = [];
		_forEach(arr, function (x, i, a) {
			results.push(iterator(x, i, a));
		});
		return results;
	};
	var _asyncMap = function (eachfn, arr, iterator, callback) {
		var results = [];
		arr = _map(arr, function (x, i) {
			return {index: i, value: x};
		});
		eachfn(arr, function (x, callback) {
			iterator(x.value, function (err, v) {
				results[x.index] = v;
				callback(err);
			});
		}, function (err) {
			callback(err, results);
		});
	};
	async.forEach = function (arr, iterator, callback) {
		if (!arr.length) {
			return callback();
		}
		var completed = 0;
		_forEach(arr, function (x) {
			iterator(x, function (err) {
				if (err) {
					callback(err);
					callback = function () {};
				} else {
					completed += 1;
					if (completed === arr.length) {
						callback();
					}
				}
			});
		});
	};
	var doParallel = function (fn) {
		return function () {
			var args = Array.prototype.slice.call(arguments);
			return fn.apply(null, [async.forEach].concat(args));
		};
	};
	async.map = doParallel(_asyncMap);
	async.parallel = function (tasks, callback) {
		callback = callback || function () {};
		if (tasks.constructor === Array) {
			async.map(tasks, function (fn, callback) {
				if (fn) {
					fn(function (err) {
						var args = Array.prototype.slice.call(arguments, 1);
						if (args.length <= 1) {
							args = args[0];
						}
						callback.call(null, err, args);
					});
				}
			}, callback);
		}
	};
	return async;
}();
var JUST = function(newOptions) {
	var options = {
		open : '<%',
		close : '%>',
		ext : '.html',
		useCache : true,
		watchForChanges : false,
		root : ''
	},
	cache = {},
	loaders = {},
	watchers = {};
	this.configure = function(newOptions) {
		for (var option in options) {
			options[option] = newOptions[option] || options[option];
		}
	};
	this.render = function(template, data, callback) {
		var tpl = new Template(template, data);
		tpl.render(callback);
	};
	this.configure(newOptions);

	var regExpEscape = function (str) {
		return String(str).replace(/([.*+?^=!:${}()|[\]\/\\])/g,'\\$1');
	};

	var parse = function(html) {
		var
			lineNo = 1,
			buffer = [ 'with (this.data) { with (this.customData) { this.buffer.push(\'' ];

		var matches = html.split(new RegExp(regExpEscape(options.open) + '((?:.|[\r\n])+?)(?:' + regExpEscape(options.close) + '|$)'));
		for (var i = 0, length = matches.length; i < length; i++) {
			var text = matches[i];
			if (i & 1) {
				var prefix, postfix, line = 'this.line=' + lineNo, jsFromPos = 1;
				switch (text.charAt(0)) {
					case '@' :
						prefix = '\', (' + line + ', this.partial(\'';
						postfix = '\')), \'';
						break;
					case '!' :
						prefix = '\', (' + line + ', this.extend(\'';
						postfix = '\')), \'';
						break;
					case '*' :
						prefix = '\', (' + line + ', this.child(\'';
						postfix = '\')), \'';
						break;
					case '[' :
						prefix = '\');' + line + ';this.blockStart(\'';
						postfix = '\'); this.buffer.push(\'';
						break;
					case ']' :
						prefix = '\');' + line + ';this.blockEnd(';
						postfix = '); this.buffer.push(\'';
						break;
					case '=' :
						prefix = '\', (' + line + ', ';
						postfix = '), \'';
						break;
					default :
						prefix = '\');' + line + ';';
						postfix = '; this.buffer.push(\'';
						jsFromPos = 0;
				}
				buffer.push(prefix, text.substr(jsFromPos).replace(/^\s+|\s+$/g, ''), postfix);
			} else {
				buffer.push(text.replace(/[\\']/g, '\\$&').replace(/\r/g, ' ').replace(/\n/g, '\\n'));
			}
			lineNo += text.split(/\n/).length - 1;
		}
		buffer.push('\'); } } return this.buffer;');
		buffer = buffer.join('');
		return new Function(buffer);
	};
	var loaded = function(error, file, blank) {
		async.forEach(loaders[file], function(loader, callback) {
			loader(error, blank);
			callback();
		}, function() {
			delete(loaders[file]);
		});
	};
	var read = function(file, callback) {
		if (Object.prototype.toString.call(options.root) === '[object Object]') {
			try {
				var data = eval('(options.root.' + file + ')');
				if (Object.prototype.toString.call(data) === '[object String]') {
					callback(undefined, data);
				} else {
					callback('Failed to load template');
				}
			} catch (e) {
				callback(e);
			}
		} else {
			fs.readFile(file, 'utf8', callback);
		}
	};
	var load = function(file, callback) {
		if (options.useCache && cache[file]) {
			callback && callback(undefined, cache[file])
		} else {
			if (!loaders[file]) {
				loaders[file] = [];
				callback && loaders[file].push(callback);
				read(file, function(error, data) {
					if (error) {
						loaded(error, file, undefined);
					} else {
						try {
							var blank = parse(data);
							loaded(undefined, file, blank);
							if (options.useCache) {
								cache[file] = blank;
							}
							if (options.watchForChanges) {
								watchers[file] = fs.watch(file, function() {
									watchers[file].close();
									delete(watchers[file]);
									delete(cache[file]);
								});
							}
						} catch (e) {
							e.message = e.message + ' in ' + file;
							loaded(e, file, undefined);
						}
					}
				});
			} else {
				callback && loaders[file].push(callback);
			}
		}
	};
	var Template = function(file, data, customData) {
		this.file = file;
		if (Object.prototype.toString.call(options.root) === '[object String]') {
			this.file = path.normalize(options.root + '/' + file + options.ext);
		}
		this.data = data;
		this.customData = customData || {};
		this.buffer = [];
		this.tmpBuffer = undefined;
		this.watcher = undefined;
		this.line = 1;
		this.partials = [];
		this.childData = [];
		this.childError = undefined;
		this.childCallback = undefined;
		this.callback = undefined;
		this.blocks = {};
	};
	Template.prototype.blockStart = function(name) {
		this.tmpBuffer = this.buffer;
		if (!this.blocks[name]) this.blocks[name] = [];
		if (!this.blocks[name].length) {
			this.buffer = this.blocks[name];
		} else {
			this.buffer = [];
		}
	};
	Template.prototype.blockEnd = function() {
		this.buffer = this.tmpBuffer;
		delete(this.tmpBuffer);
	};
	Template.prototype.partial = function(template, customData) {
		var part = [];
		var page = new Template(template, this.data, customData);
		this.partials.push(function(callback) {
			page.render(function(error, html) {
				if (!error) part.push(html);
				callback(error);
			});
		});
		return part;
	};
	Template.prototype.extend = function(template, customData) {
		var page = new Template(template, this.data, customData);
		page.blocks = this.blocks;
		var callback = this.callback;
		this.callback = function(error, data) {
			if (error) {
				page.childError = error;
				page.childCallback && page.childCallback(error);
			} else {
				page.childData.push(data);
				page.childCallback && page.childCallback();
			}
		};
		page.partials.push(function(callback) {
			if (page.childError) {
				callback(page.childError);
			} else if (page.childData.length) {
				callback();
			} else {
				page.childCallback = callback;
			}
		});
		page.render(callback);
		return '';
	};
	Template.prototype.child = function(block) {
		if (block && block.length) {
			if (!this.blocks[block]) this.blocks[block] = [];
			return this.blocks[block];
		} else {
			return this.childData;
		}
	};
	Template.prototype.render = function(callback) {
		var that = this;
		this.callback = callback;
		load(this.file, function(error, blank) {
			if (error) {
				that.callback && that.callback(error, undefined);
			} else {
				try {
					var buffer = blank.call(that);
					async.parallel(that.partials, function(error) {
						var html = '';
						if (!error) {
							var length = buffer.length;
							for (var i = 0; i < length; i++) {
								html += (Array.isArray(buffer[i])) ? buffer[i].join('') : buffer[i];
							}
						}
						that.callback && that.callback(error, html);
					});
				} catch (e) {
					e.message = e.message + ' in ' + that.file + ' on line ' + that.line;
					that.callback && that.callback(e, undefined);
				}
			}
		});
	};
};
if (typeof module !== 'undefined' && module.exports) {
	fs = require('fs');
	path = require('path');
	module.exports = JUST;
} else {
	if (!Array.prototype.filter) {
		Array.prototype.filter = function(fun) {
			var len = this.length;
			if (typeof fun != "function") throw new TypeError();
			var res = new Array();
			var thisp = arguments[1];
			for (var i = 0; i < len; i++) {
				if (i in this) {
					var val = this[i];
					if (fun.call(thisp, val, i, this)) res.push(val);
				}
			}
			return res;
		};
	}
	if (!Array.isArray) {
		Array.isArray = function(obj) {
			return Object.prototype.toString.call(obj) === '[object Array]';
		};
	}
	this.JUST = JUST;
	path = function() {
		var normalizeArray = function(parts, allowAboveRoot) {
			var up = 0;
			for (var i = parts.length - 1; i >= 0; i--) {
				var last = parts[i];
				if (last == '.') {
					parts.splice(i, 1);
				} else if (last === '..') {
					parts.splice(i, 1);
					up++;
				} else if (up) {
					parts.splice(i, 1);
					up--;
				}
			}
			if (allowAboveRoot) {
				for (; up--; up) {
					arts.unshift('..');
				}
			}
			return parts;
		};
		var normalize = function(path) {
			var isAbsolute = path.charAt(0) === '/',
			trailingSlash = path.slice(-1) === '/';
			path = normalizeArray(path.split('/').filter(function(p) {
				return !!p;
			}), !isAbsolute).join('/');
			if (!path && !isAbsolute) {
				path = '.';
			}
			if (path && trailingSlash) {
				path += '/';
			}
			return (isAbsolute ? '/' : '') + path;
		};
		return {
			normalize: normalize
		};
	}();
	var ajaxObject = function(url, callbackFunction) {
		var that=this;
		this.updating = false;
		this.abort = function() {
			if (that.updating) {
				that.updating=false;
				that.AJAX.abort();
				that.AJAX=null;
			}
		};
		this.update = function() {
			if (that.updating) { return false; }
			that.AJAX = null;
			if (window.XMLHttpRequest) {
				that.AJAX=new XMLHttpRequest();
				that.AJAX.overrideMimeType && that.AJAX.overrideMimeType('text/html');
			} else {
				that.AJAX=new ActiveXObject('Microsoft.XMLHTTP');
			}
			if (that.AJAX==null) {
				return false;
			} else {
				that.AJAX.onreadystatechange = function() {
					if (that.AJAX.readyState==4) {
						that.updating=false;
						that.callback(that.AJAX.responseText,that.AJAX.status,that.AJAX.responseXML);
						that.AJAX=null;
					}
				};
				that.updating = new Date();
				that.AJAX.open('GET', url, true);
				that.AJAX.send(null);
				return true;
			}
		};
		this.callback = callbackFunction || function () { };
	};
	fs = function() {
		var readFile = function(file, encoding, callback) {
			var request = new ajaxObject(file, function(data, status) {
				if (status < 200 || status > 399) {
					callback('Failed to load template');
				} else {
					callback(undefined, data);
				}
			});
			try {
				request.update();
			} catch(e) {
				callback(e);
			}
		};
		var watch = function() {};
		return {
			readFile: readFile,
			watch: watch
		};
	}();
}
}());
