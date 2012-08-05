var JUST = require('./../index');

var just = new JUST({ root : __dirname + '/view', useCache : true, ext : '.html' });

just.render('page', { title: 'Hello, World!' }, function(error, html) {
	console.log(error);
	console.log(html);
});
