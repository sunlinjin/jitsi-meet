/*
 * Copyright @ 2015 Atlassian Pty Ltd
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import UIEvents from '../service/UI/UIEvents';
import VideoLayout from './UI/videolayout/VideoLayout';
import FilmStrip from './UI/videolayout/FilmStrip';

/**
 * The (name of the) command which transports the state (represented by
 * {State} for the local state at the time of this writing) of a {FollowMe}
 * (instance) between participants.
 */
const _COMMAND = "follow-me";

/**
 * The timeout after which a follow-me command that has been received will be
 * ignored if not consumed.
 *
 * @type {number} in seconds
 * @private
 */
const _FOLLOW_ME_RECEIVED_TIMEOUT = 30;

/**
 * Represents the set of {FollowMe}-related states (properties and their
 * respective values) which are to be followed by a participant. {FollowMe}
 * will send {_COMMAND} whenever a property of {State} changes (if the local
 * participant is in her right to issue such a command, of course).
 */
class State {
    /**
     * Initializes a new {State} instance.
     *
     * @param propertyChangeCallback {Function} which is to be called when a
     * property of the new instance has its value changed from an old value
     * into a (different) new value. The function is supplied with the name of
     * the property, the old value of the property before the change, and the
     * new value of the property after the change.
     */
    constructor (propertyChangeCallback) {
        this._propertyChangeCallback = propertyChangeCallback;
    }

    get filmStripVisible () { return this._filmStripVisible; }

    set filmStripVisible (b) {
        var oldValue = this._filmStripVisible;
        if (oldValue !== b) {
            this._filmStripVisible = b;
            this._firePropertyChange('filmStripVisible', oldValue, b);
        }
    }

    get nextOnStage() { return this._nextOnStage; }

    set nextOnStage(id) {
        var oldValue = this._nextOnStage;
        if (oldValue !== id) {
            this._nextOnStage = id;
            this._firePropertyChange('nextOnStage', oldValue, id);
        }
    }

    get sharedDocumentVisible () { return this._sharedDocumentVisible; }

    set sharedDocumentVisible (b) {
        var oldValue = this._sharedDocumentVisible;
        if (oldValue !== b) {
            this._sharedDocumentVisible = b;
            this._firePropertyChange('sharedDocumentVisible', oldValue, b);
        }
    }

    /**
     * Invokes {_propertyChangeCallback} to notify it that {property} had its
     * value changed from {oldValue} to {newValue}.
     *
     * @param property the name of the property which had its value changed
     * from {oldValue} to {newValue}
     * @param oldValue the value of {property} before the change
     * @param newValue the value of {property} after the change
     */
    _firePropertyChange (property, oldValue, newValue) {
        var propertyChangeCallback = this._propertyChangeCallback;
        if (propertyChangeCallback)
            propertyChangeCallback(property, oldValue, newValue);
    }
}

/**
 * Represents the &quot;Follow Me&quot; feature which enables a moderator to
 * (partially) control the user experience/interface (e.g. film strip
 * visibility) of (other) non-moderator particiapnts.
 *
 * @author Lyubomir Marinov
 */
class FollowMe {
    /**
     * Initializes a new {FollowMe} instance.
     *
     * @param conference the {conference} which is to transport
     * {FollowMe}-related information between participants
     * @param UI the {UI} which is the source (model/state) to be sent to
     * remote participants if the local participant is the moderator or the
     * destination (model/state) to receive from the remote moderator if the
     * local participant is not the moderator
     */
    constructor (conference, UI) {
        this._conference = conference;
        this._UI = UI;
        this.nextOnStageTimer = 0;

        // The states of the local participant which are to be followed (by the
        // remote participants when the local participant is in her right to
        // issue such commands).
        this._local = new State(this._localPropertyChange.bind(this));

        // Listen to "Follow Me" commands. I'm not sure whether a moderator can
        // (in lib-jitsi-meet and/or Meet) become a non-moderator. If that's
        // possible, then it may be easiest to always listen to commands. The
        // listener will validate received commands before acting on them.
        conference.commands.addCommandListener(
                _COMMAND,
                this._onFollowMeCommand.bind(this));
    }

    /**
     * Adds listeners for the UI states of the local participant which are
     * to be followed (by the remote participants). A non-moderator (very
     * likely) can become a moderator so it may be easiest to always track
     * the states of interest.
     * @private
     */
    _addFollowMeListeners () {
        this.filmStripEventHandler = this._filmStripToggled.bind(this);
        this._UI.addListener(UIEvents.TOGGLED_FILM_STRIP,
                            this.filmStripEventHandler);

        var self = this;
        this.pinnedEndpointEventHandler = function (smallVideo, isPinned) {
            self._nextOnStage(smallVideo, isPinned);
        };
        this._UI.addListener(UIEvents.PINNED_ENDPOINT,
                            this.pinnedEndpointEventHandler);

        this.sharedDocEventHandler = this._sharedDocumentToggled.bind(this);
        this._UI.addListener( UIEvents.TOGGLED_SHARED_DOCUMENT,
                            this.sharedDocEventHandler);
    }

    /**
     * Removes all follow me listeners.
     * @private
     */
    _removeFollowMeListeners () {
        this._UI.removeListener(UIEvents.TOGGLED_FILM_STRIP,
                                this.filmStripEventHandler);
        this._UI.removeListener(UIEvents.TOGGLED_SHARED_DOCUMENT,
                                this.sharedDocEventHandler);
        this._UI.removeListener(UIEvents.PINNED_ENDPOINT,
                                this.pinnedEndpointEventHandler);
    }

    /**
     * Enables or disabled the follow me functionality
     *
     * @param enable {true} to enable the follow me functionality, {false} -
     * to disable it
     */
    enableFollowMe (enable) {
        this.isEnabled = enable;
        if (this.isEnabled)
            this._addFollowMeListeners();
        else
            this._removeFollowMeListeners();
    }

    /**
     * Notifies this instance that the (visibility of the) film strip was
     * toggled (in the user interface of the local participant).
     *
     * @param filmStripVisible {Boolean} {true} if the film strip was shown (as
     * a result of the toggle) or {false} if the film strip was hidden
     */
    _filmStripToggled (filmStripVisible) {
        this._local.filmStripVisible = filmStripVisible;
    }

    /**
     * Notifies this instance that the (visibility of the) shared document was
     * toggled (in the user interface of the local participant).
     *
     * @param sharedDocumentVisible {Boolean} {true} if the shared document was
     * shown (as a result of the toggle) or {false} if it was hidden
     */
    _sharedDocumentToggled (sharedDocumentVisible) {
        this._local.sharedDocumentVisible = sharedDocumentVisible;
    }

    /**
     * Changes the nextOnPage property value.
     *
     * @param smallVideo the {SmallVideo} that was pinned or unpinned
     * @param isPinned indicates if the given {SmallVideo} was pinned or
     * unpinned
     * @private
     */
    _nextOnStage (smallVideo, isPinned) {
        if (!this._conference.isModerator)
            return;

        var nextOnStage = null;
        if(isPinned)
            nextOnStage = smallVideo.getId();

        this._local.nextOnStage = nextOnStage;
    }

    /**
     * Sends the follow-me command, when a local property change occurs.
     *
     * @param property the property name
     * @param oldValue the old value
     * @param newValue the new value
     * @private
     */
    _localPropertyChange (property, oldValue, newValue) {
        // Only a moderator is allowed to send commands.
        var conference = this._conference;
        if (!conference.isModerator)
            return;

        var commands = conference.commands;
        // XXX The "Follow Me" command represents a snapshot of all states
        // which are to be followed so don't forget to removeCommand before
        // sendCommand!
        commands.removeCommand(_COMMAND);
        var self = this;
        commands.sendCommandOnce(
                _COMMAND,
                {
                    attributes: {
                        filmStripVisible: self._local.filmStripVisible,
                        nextOnStage: self._local.nextOnStage,
                        sharedDocumentVisible: self._local.sharedDocumentVisible
                    }
                });
    }

    /**
     * Notifies this instance about a &qout;Follow Me&qout; command (delivered
     * by the Command(s) API of {this._conference}).
     *
     * @param attributes the attributes {Object} carried by the command
     * @param id the identifier of the participant who issued the command. A
     * notable idiosyncrasy of the Command(s) API to be mindful of here is that
     * the command may be issued by the local participant.
     */
    _onFollowMeCommand ({ attributes }, id) {
        // We require to know who issued the command because (1) only a
        // moderator is allowed to send commands and (2) a command MUST be
        // issued by a defined commander.
        if (typeof id === 'undefined')
            return;

        // The Command(s) API will send us our own commands and we don't want
        // to act upon them.
        if (this._conference.isLocalId(id))
            return;

        if (!this._conference.isParticipantModerator(id))
        {
            console.warn('Received follow-me command ' +
                'not from moderator');
            return;
        }

        // Applies the received/remote command to the user experience/interface
        // of the local participant.
        this._onFilmStripVisible(attributes.filmStripVisible);
        this._onNextOnStage(attributes.nextOnStage);
        this._onSharedDocumentVisible(attributes.sharedDocumentVisible);
    }

    _onFilmStripVisible(filmStripVisible) {
        if (typeof filmStripVisible !== 'undefined') {
            // XXX The Command(s) API doesn't preserve the types (of
            // attributes, at least) at the time of this writing so take into
            // account that what originated as a Boolean may be a String on
            // receipt.
            filmStripVisible = (filmStripVisible == 'true');

            // FIXME The UI (module) very likely doesn't (want to) expose its
            // eventEmitter as a public field. I'm not sure at the time of this
            // writing whether calling UI.toggleFilmStrip() is acceptable (from
            // a design standpoint) either.
            if (filmStripVisible !== FilmStrip.isFilmStripVisible())
                this._UI.eventEmitter.emit(UIEvents.TOGGLE_FILM_STRIP);
        }
    }

    _onNextOnStage(id) {
        var clickId = null;
        var pin;
        if(typeof id !== 'undefined' && !VideoLayout.isPinned(id)) {
            clickId = id;
            pin = true;
        }
        else if (typeof id == 'undefined' && VideoLayout.getPinnedId()) {
            clickId = VideoLayout.getPinnedId();
            pin = false;
        }

        if (clickId)
            this._pinVideoThumbnailById(clickId, pin);
    }

    _onSharedDocumentVisible(sharedDocumentVisible) {
        if (typeof sharedDocumentVisible !== 'undefined') {
            // XXX The Command(s) API doesn't preserve the types (of
            // attributes, at least) at the time of this writing so take into
            // account that what originated as a Boolean may be a String on
            // receipt.
            sharedDocumentVisible = (sharedDocumentVisible == 'true');

            if (sharedDocumentVisible
                !== this._UI.getSharedDocumentManager().isVisible())
                this._UI.getSharedDocumentManager().toggleEtherpad();
        }
    }

    /**
     * Pins / unpins the video thumbnail given by clickId.
     *
     * @param clickId the identifier of the video thumbnail to pin or unpin
     * @param pin {true} to pin, {false} to unpin
     * @private
     */
    _pinVideoThumbnailById(clickId, pin) {
        var self = this;
        var smallVideo = VideoLayout.getSmallVideo(clickId);

        // If the SmallVideo for the given clickId exists we proceed with the
        // pin/unpin.
        if (smallVideo) {
            this.nextOnStageTimer = 0;
            clearTimeout(this.nextOnStageTimout);
            if (pin && !VideoLayout.isPinned(clickId)
                || !pin && VideoLayout.isPinned(clickId))
                VideoLayout.handleVideoThumbClicked(clickId);
        }
        // If there's no SmallVideo object for the given id, lets wait and see
        // if it's going to be created in the next 30sec.
        else {
            this.nextOnStageTimout = setTimeout(function () {
                if (self.nextOnStageTimer > _FOLLOW_ME_RECEIVED_TIMEOUT) {
                    self.nextOnStageTimer = 0;
                    return;
                }

                this.nextOnStageTimer++;
                self._pinVideoThumbnailById(clickId, pin);
            }, 1000);
        }
    }
}

export default FollowMe;