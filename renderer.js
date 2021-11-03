const Store = require('electron-store');
const { ipcRenderer } = require('electron');
const React = require('react');
const { useState } = React;
const ReactDOM = require('react-dom');
const moment = require('moment');

const store = new Store();

// To avoid using webpack, we'll just use react without JSX
const h = React.createElement;

function WallPaperList( props ) {

	// Set the state
	const [current, setCurrent] = useState( store.get( 'current.key', '' ) );

	let available_wallpapers = store.get( 'available-wallpapers.list', [] );
	// let current = store.get( 'current.key', '' );

	const render_months = () => {
		let list = [];

		// Loop over all months
		for( month in available_wallpapers ) {
			let current_item_key = month;
			list.push( h( WallPaperItem, {
				key: month,
				month: month,
				path: props.path,
				onChange: () => { setCurrent( current_item_key ) },
				wallpapers: available_wallpapers[ month ],
				is_current: current == month
			} ) );
		}

		// Show the list in reverse
		return list.reverse();
	}


	return h('div', { className:"wallpapers" }, [
		h( 'ul', { key: 'list' }, render_months() )
	]);
}

function WallPaperItem( props ){
	return h( 'li', { key: props.month + '-item', className: props.is_current ? 'current' : '' }, [
		h( 'img', {
			key: props.month + '-image',
			// The images are huge, maybe we need to generate thumbnails
			src: 'file://' + props.path + '/files/' + props.wallpapers.landscape,
		} ),
		h( 'div', {
			key: props.month + '-date', className:'month', 
		}, [
			h( 'span', {
				key: props.month + '-date-text',
			}, moment( props.month ).format('MMMM YYYY') ),
			h( 'button', {
				key: props.month + '-apply-wallpaper',
				onClick: () => {
					ipcRenderer.send('set-wallpaper', props.month);
					// We let the parent know that this item was clicked
					props.onChange();
				}
			}, props.is_current ? 'Active' : 'Apply' ),
		] )
	] );
}

window.addEventListener('DOMContentLoaded', () => {
	ipcRenderer.invoke('read-user-data-path').then( (result) => {
		ReactDOM.render(h(WallPaperList, { path: result }), document.getElementById('wallpapers'));
	});

})