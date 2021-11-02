const { app, Menu, Tray, BrowserWindow, screen } = require('electron')
const wallpaper = require('wallpaper');
const Downloader = require('nodejs-file-downloader');
const Moment = require('moment');
var fs   = require('fs');
const storage = require('electron-json-storage');
const fetch = require('node-fetch');
const EventEmitter = require('events');

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
var tray;
var timeout = 0;

app.whenReady().then(() => {

  // storage.clear(function(error) {
  //   if (error) throw error;
  // });

  eventEmitter.on('wallpaper-list-updated', sync_wallpapers );
  eventEmitter.on('wallpaper-downloaded', save_wallpaper_setting );
  
  eventEmitter.on('wallpaper-changed', update_menu );
  eventEmitter.on('wallpaper-list-updated', update_menu );

  load_available_wallpapers();

  

  tray = new Tray('menuIconTemplate.png');
  
  // set the intial menu
  update_menu();

  // We want to resett the background, every time
  // the monitor setup changes
  app.on('gpu-info-update', handle_monitor_change);
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
      enabled: available.list && current.key != last_month,
      click: () => {
        storage.set(
          'current',
          {
            month: last,
            key: last_month
          },
          () => set_wallpapers( last )  
        );
      }
    },
    {
      id: 'apply-random',
      label: 'Apply random wallpaper',
      enabled: available.list || false,
      click: () => {
        let months = Object.keys( available.list );

        // remove the current wallpaper
        var index = months.indexOf( current.key );
        if (index !== -1) {
          months.splice(index, 1);
        }

        let random_month = months[ Math.floor( Math.random() * months.length ) ];
        let item = available.list[ random_month ];
        
        storage.set('current', {
          month: item,
          key: random_month
        }, () => {
          set_wallpapers( item );
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Check for updates',
      click: load_available_wallpapers
    }
  ])
  tray.setToolTip('Time for a new look?');
  tray.setContextMenu(contextMenu);
}

/*
 * Downloads the feed of available wallpapers from github
 */
function load_available_wallpapers(){

  let url = "https://raw.githubusercontent.com/Nettmaker/wallpapers/main/wallpapers.json";

  let settings = { method: "Get" };

  fetch(url, settings)
      .then(res => res.json())
      .then((json) => {
        console.log('downloaded');
        storage.set( 'available-wallpapers', {
          list: json,
          timestamp: + new Date()
        }, () => {
          eventEmitter.emit('wallpaper-list-updated', json);
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

    if( item.portrait && !data.portrait ) {
      download_wallpaper( item.portrait, 'portrait', month );
    }
    
    if( item.landscape && !data.landscape ) {
      download_wallpaper( item.landscape, 'landscape', month );
    }
  }
}

function save_wallpaper_setting( filename, orientation, key ){
  if( key && orientation ) {
    var data = storage.getSync( 'wallpapers.' + key );

    data[orientation] = filename;
    storage.set( 'wallpapers.' + key, data );
  }
}

// function wallpaper_exists( filename ){
//   console.log( 'check for ' + filename );
//   try {
//     if ( fs.existsSync( app.getAppPath() + '/files/' + filename ) ) {
//       return true
//     }
//   } catch(err) {
//     console.error(err)
//   }

//   return false;
// }

function download_wallpaper( filename, orientation = '', key = false ){
  console.log( 'downloading ' + filename );
  (async () => {//Wrapping the code with an async function, just for the sake of example.

    const downloader = new Downloader({
      url: "https://github.com/Nettmaker/wallpapers/raw/main/" + filename,
      directory: "./files",//This folder will be created, if it doesn't exist.               
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
      
      if( path != app.getAppPath() + '/files/' + image ) {
        console.log('wallpaper on screen ' + screen + ' has changed – updating it now');
        wallpaper.set( './files/' + image, {
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