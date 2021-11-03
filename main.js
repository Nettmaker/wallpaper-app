const { app, Menu, Tray, BrowserWindow, screen, powerMonitor, Notification } = require('electron')
const {enforceMacOSAppLocation, showAboutWindow} = require('electron-util');
const wallpaper = require('wallpaper');
const Downloader = require('nodejs-file-downloader');
const storage = require('electron-json-storage');
const fs = require('fs');
const fetch = require('node-fetch');
const EventEmitter = require('events');
const { autoUpdater } = require("electron-updater");

/**
 * How this should work.
 * 
 * When you load the app, it will scan our API endpoint,
 * and load the number of available wallpapers. It will
 * then start to download them all.
 * 
 * Every time the OS resumes, we check if a new wallpaper
 * is available. When a new version is available, we
 * download it in the background, and then send off a
 * notification – asking if you want to switch.
 * 
 * We also create an option for selecting a random
 * wallpaper. When we do, we check if you have a portrait
 * screen, and limit our options based on that.
 * 
 * It should also be possible to select a wallpaper from
 * a list.
 * 
 * 
 * Stuff to make
 * 1) API that lists available wallpapers
 * 2) Download manager, that downloads the files
 * 3) Menu bar icon
 * 4) UI for selecting a specific background
 * 
 */

const eventEmitter = new EventEmitter();
var tray = false;
var timeout = 0;

app.whenReady().then(() => {

	app.dock.hide();

	enforceMacOSAppLocation();
	
	load_available_wallpapers();

	eventEmitter.on('wallpaper-list-updated', sync_wallpapers );
	eventEmitter.on('wallpaper-downloaded', save_wallpaper_setting );
	
	eventEmitter.on('wallpaper-changed', update_menu );
	eventEmitter.on('wallpaper-list-updated', update_menu );

	powerMonitor.on('unlock-screen', () => {
		var available = storage.getSync('available-wallpapers');
		var ONE_HOUR = 30 * 60 * 1000;
		
		if( available.timestamp ) {
			if( ( (new Date) - available.timestamp ) < ONE_HOUR ) {
				console.log('Checked for new wallpapers less than an 30 minutes ago, lets wait…');
				return;
			}
		}

		console.log('All right, lets check for new wallpapers');

		load_available_wallpapers();
	});

	tray = new Tray( app.getAppPath() + '/menuIconTemplate.png' );
	
	// set the intial menu
	update_menu();

	// We want to resett the background, every time
	// the monitor setup changes
	app.on('gpu-info-update', handle_monitor_change);

	autoUpdater.checkForUpdatesAndNotify();
});

function handle_monitor_change(){
	// Todo: check if anything actually changed
	clearTimeout( timeout );
	timeout = setTimeout( () => {
		var current = storage.getSync('current');
		console.log( 'applying the background again' );
		if( current.month ) {
			set_wallpapers( current.month );
		}
	}, 300 );
}

function show_new_wallpaper_notification(){
	let notification = new Notification({
		title: 'New Wallpaper!',
		body: 'A new Nettmaker wallpaper has arrived!',
		actions: [
			{
				type: 'button',
				text: 'Apply'
			}
		]
	});

	notification.on( 'action', function(){
		set_wallpaper_to_latest();
	});

	notification.show();
}

// When an update is downloaded, automatically restart the app
autoUpdater.on('update-downloaded', () => {
	autoUpdater.quitAndInstall();
});

function set_wallpaper_to_latest(){
	var available = storage.getSync('available-wallpapers');

	if( available.list ) {
		var last_month = Object.keys( available.list ).pop();
		var last = available.list[ last_month ];
		
		storage.set(
			'current',
			{
				month: last,
				key: last_month
			},
			() => set_wallpapers( last )  
		);
	}
}

/**
 * Renders the tray menu items, this is reloaded when
 * setting change
 */
function update_menu(){

	var current = storage.getSync('current');
	var available = storage.getSync('available-wallpapers');

	if( available.list ) {
		var last_month = Object.keys( available.list ).pop();
		var last = available.list[ last_month ];
	}


	const contextMenu = Menu.buildFromTemplate([
		{
			id: 're-apply',
			label: 'Re-apply wallpaper',
			enabled: current.month ? true : false,
			click: () => {
				if( current.month ) {
					set_wallpapers( current.month );
				} else {
					// Show an error
				}
			}
		},
		{ type: 'separator' },
		{
			id: 'apply-latest',
			label: 'Apply latest wallpaper',
			enabled: currently_using_latest(),
			click: () => {
				set_wallpaper_to_latest()
			}
		},
		{
			id: 'apply-random',
			label: 'Apply random wallpaper',
			enabled: available.list || false,
			click: () => {
				let background_list = {...available.list};

				if( background_list[ current.key ] ) {
					delete background_list[ current.key ];
				}

				if( has_portrait_screens() ) {
					for( item_month in background_list ) {
						let current_item = background_list[ item_month ];

						if( !current_item.portrait ) {
							delete background_list[ item_month ];
						}
					}
				}

				let keys = Object.keys( background_list );
				let random_month = keys[ Math.floor( Math.random() * keys.length ) ];
				let item = available.list[ random_month ];

				storage.set(
					'current',
					{
						month: item,
						key: random_month
					},
					() => {
							set_wallpapers( item );
					}
				);
			}
		},
		{ type: 'separator' },
		{
			label: ( (storage.getSync('auto_open')).active ? '✓ ' : '' ) + 'Start at login',
			click: function(){
				let open_at_login = storage.getSync( 'auto_open' );
				app.setLoginItemSettings({
					openAtLogin: !open_at_login.active
				});

				open_at_login.active = !open_at_login.active;
				
				storage.set( 'auto_open', open_at_login, () => {
					update_menu();
				} );

			}
		},
		{
			label: 'Check for new wallpapers',
			click: load_available_wallpapers
		},
		{
			label: 'About',
			click: () => {
				showAboutWindow( {
					copyright: 'Copyright © Thomas Bensmann',
					text: 'Because sometimes simple problems need complex solutions.'
				})
			}
		},
		{ type: 'separator' },
		{
			label: 'Quit',
			click: () => { app.quit() }
		}
	])
	tray.setToolTip('Time for a new look?');
	tray.setContextMenu(contextMenu);
}

/*
 * Downloads the feed of available wallpapers from github
 */
function load_available_wallpapers(){

	console.log('Checking for new wallpapers');

	let url = "https://raw.githubusercontent.com/Nettmaker/wallpapers/main/wallpapers.json";

	let settings = { method: "Get" };

	fetch(url, settings)
			.then(res => res.json())
			.then((json) => {
				console.log('downloaded');

				let available = storage.getSync( 'available-wallpapers' );

				let update_wallpaper = false;

				// If we had a list already
				if( available.list ) {
					let keys = Object.keys( available.list );
					let last_key = keys.pop();

					let new_keys = Object.keys( json );
					let new_last_key = new_keys.pop();

					// And the latest wallpaper changed
					if( last_key != new_last_key ) {

						if( currently_using_latest() ) {
							// If currently using "latest" wallpaper then
							// just apply the new one automatically.
							update_wallpaper = true;
						} else {
							// Show a notification
							show_new_wallpaper_notification();
						}
					}
				}

				storage.set( 'available-wallpapers', {
					list: json,
					timestamp: + new Date()
				}, () => {
					eventEmitter.emit('wallpaper-list-updated', json);
					if( update_wallpaper ) {
						set_wallpaper_to_latest();
					}
				});
				
			});
}

/*
 * This function will check all the wallpapers in the
 * feed, and download them if they don't exist already
 */
function sync_wallpapers( list ){
	for( month in list ) {

		var item = list[month];

		var data = storage.getSync( 'wallpapers.' + month );

		if( item.portrait && !(data.portrait && wallpaper_exists( item.portrait ) ) ) {
			download_wallpaper( item.portrait, 'portrait', month );
		}
		
		if( item.landscape && !(data.landscape && wallpaper_exists( item.landscape ) ) ) {
			download_wallpaper( item.landscape, 'landscape', month );
		}
	}
}

function currently_using_latest(){
	var current = storage.getSync('current');
	var available = storage.getSync('available-wallpapers');

	if( !available.list ) {
		return false;
	}
	
	var last_month = Object.keys( available.list ).pop();

	return current.month && current.month == last_month;
}

function save_wallpaper_setting( filename, orientation, key ){
	if( key && orientation ) {
		var data = storage.getSync( 'wallpapers.' + key );

		data[orientation] = filename;
		storage.set( 'wallpapers.' + key, data );
	}
}

function wallpaper_exists( filename ){
	console.log( 'check for ' + filename );
	try {
		if ( fs.existsSync( app.getPath( 'userData' ) + '/files/' + filename ) ) {
			return true
		}
	} catch(err) {
		console.error(err)
	}

	return false;
}

function download_wallpaper( filename, orientation = '', key = false ){
	console.log( 'downloading ' + filename );
	(async () => {//Wrapping the code with an async function, just for the sake of example.

		const downloader = new Downloader({
			url: "https://github.com/Nettmaker/wallpapers/raw/main/" + filename,
			maxAttempts: 5,
			cloneFiles:false,
			directory: app.getPath( 'userData' ) + "/files",//This folder will be created, if it doesn't exist.               
		})
	
		try {
			await downloader.download();//Downloader.download() returns a promise.
			eventEmitter.emit('wallpaper-downloaded', filename, orientation, key);
		} catch (error) {
			//IMPORTANT: Handle a possible error. An error is thrown in case of network errors, or status codes of 400 and above.
			//Note that if the maxAttempts is set to higher than 1, the error is thrown only if all attempts fail.
			console.log('Download failed',error);
		}


	})(); 
}

function has_portrait_screens(){
	const displays = screen.getAllDisplays();
	for( var i = 0; i < displays.length; i++ ) {
		
		let is_portrait = displays[i].bounds.width < displays[i].bounds.height;
		
		if( is_portrait ) {
			return true;
		}
	}

	return false;
}

function set_wallpapers( month ) {
	const displays = screen.getAllDisplays();

	if( month.portrait && !wallpaper_exists( month.portrait ) ) {
		return;
	}

	if( month.landscape && !wallpaper_exists( month.landscape ) ) {
		return;
	}

	for( var i = 0; i < displays.length; i++ ) {
		
		console.log( 'Checking screen ' + i );

		let is_portrait = displays[i].bounds.width < displays[i].bounds.height;
		let image = month.landscape;
		
		if( is_portrait && month.portrait ) {
			image = month.portrait;
		}

		let screen = i;

		wallpaper.get({
			screen: screen
		}).then( ( path ) => {
			
			if( path != app.getPath( 'userData' ) + '/files/' + image ) {
				console.log('wallpaper on screen ' + screen + ' has changed – updating it now');
				wallpaper.set( app.getPath( 'userData' ) + '/files/' + image, {
					'screen': screen,
					'scale': 'fill'
				});
			} else {
				console.log('wallpaper unchanged, skip…');
			}
			
		} );

	}

	eventEmitter.emit('wallpaper-changed', month);
}